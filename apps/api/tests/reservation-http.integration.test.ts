import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createApp } from "../src/app.js";
import type { ReservationConfirmation } from "../src/notifications/notification-service.js";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/bookerdoc_test") throw new Error("Use npm test");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
let patientId: string, doctorId: string, serviceId: string;
let delivered: ReservationConfirmation[];
const now = () => new Date("2030-01-01T00:00:00Z");
const payload = () => ({ patientId, doctorId, serviceId, startsAt: "2030-02-04T09:00:00+01:00" });
const app = () => createApp({ db, now, notifications: {
  async sendReservationConfirmation(message) { delivered.push(message); },
} });

beforeEach(async () => {
  [patientId, doctorId, serviceId] = [randomUUID(), randomUUID(), randomUUID()];
  delivered = [];
  await db.user.create({ data: { id: patientId, name: "HTTP patient", email: `${patientId}@example.test` } });
  await db.doctor.create({ data: { id: doctorId, name: "HTTP doctor" } });
  await db.service.create({ data: { id: serviceId, doctorId, name: "Consultation", durationMinutes: 30 } });
  await db.workingWindow.create({ data: { doctorId, weekday: 1, startMinute: 480, endMinute: 960 } });
});
afterEach(async () => {
  try {
    await db.$transaction([
      db.reservation.deleteMany({ where: { patientId } }),
      db.workingWindow.deleteMany({ where: { doctorId } }),
      db.service.deleteMany({ where: { doctorId } }),
      db.doctor.deleteMany({ where: { id: doctorId } }),
      db.user.deleteMany({ where: { id: patientId } }),
    ]);
  } finally { await db.$disconnect(); }
});

describe("POST /reservations — CP1 HTTP to PostgreSQL", () => {
  it("returns 201 and persists a confirmed reservation with calculated end", async () => {
    const response = await request(app()).post("/reservations").send(payload()).expect(201);
    expect(response.body).toEqual({ id: expect.any(String), status: "CONFIRMED",
      startsAt: "2030-02-04T08:00:00.000Z", endsAt: "2030-02-04T08:30:00.000Z" });
    const row = await db.reservation.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(row).toMatchObject({ patientId, doctorId, serviceId, status: "CONFIRMED",
      startsAt: new Date(response.body.startsAt), endsAt: new Date(response.body.endsAt) });
    expect(delivered).toEqual([{ reservationId: row.id, recipient: `${patientId}@example.test`,
      doctorName: "HTTP doctor", serviceName: "Consultation", startsAt: row.startsAt, endsAt: row.endsAt }]);
  });

  it.each([
    { patientId: "bad-id" }, { startsAt: "2030-02-04T09:00:00" },
    { startsAt: "2030-02-30T09:00:00Z" }, { startsAt: "2029-02-04T09:00:00Z" },
    { startsAt: "2030-02-04T15:45:00+01:00" }, { startsAt: "2030-02-05T09:00:00+01:00" },
    { startsAt: "2030-02-04T09:01:00+01:00" }, { startsAt: "2030-02-04T09:00:01+01:00" },
    { status: "DRAFT" }, { endsAt: "2030-02-04T10:00:00Z" },
  ])("rejects invalid input %j with no write or notification", async patch => {
    await request(app()).post("/reservations").send({ ...payload(), ...patch }).expect(400);
    expect(await db.reservation.count({ where: { patientId } })).toBe(0);
    expect(delivered).toEqual([]);
  });
  it.each(["patientId", "doctorId", "serviceId"])("returns 404 for nonexistent %s", async field => {
    await request(app()).post("/reservations").send({ ...payload(), [field]: randomUUID() }).expect(404);
    expect(await db.reservation.count({ where: { patientId } })).toBe(0);
    expect(delivered).toEqual([]);
  });
  it("rejects a service belonging to a different doctor", async () => {
    const other = await db.doctor.create({ data: { name: "Other doctor" } });
    try {
      await request(app()).post("/reservations").send({ ...payload(), doctorId: other.id }).expect(400);
      expect(await db.reservation.count({ where: { patientId } })).toBe(0);
    } finally { await db.doctor.delete({ where: { id: other.id } }); }
  });
  it("returns a JSON 400 for malformed JSON", async () => {
    const response = await request(app()).post("/reservations").set("Content-Type", "application/json").send('{"broken":').expect(400);
    expect(response.body.error.code).toBe("INVALID_INPUT");
  });
  it("rejects overlap, but allows adjacency and different services after the previous end", async () => {
    const api = app();
    await request(api).post("/reservations").send(payload()).expect(201);
    const otherService = await db.service.create({ data: { doctorId, name: "Other service", durationMinutes: 15 } });
    await request(api).post("/reservations").send({ ...payload(), serviceId: otherService.id, startsAt: "2030-02-04T09:15:00+01:00" }).expect(409);
    await request(api).post("/reservations").send({ ...payload(), startsAt: "2030-02-04T09:30:00+01:00" }).expect(201);
    expect(await db.reservation.count({ where: { patientId } })).toBe(2);
    expect(delivered).toHaveLength(2);
  });
  it("confirms exactly one of two concurrent overlapping requests", async () => {
    const api = app();
    const responses = await Promise.all([
      request(api).post("/reservations").send(payload()),
      request(api).post("/reservations").send(payload()),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await db.reservation.count({ where: { patientId, status: "CONFIRMED" } })).toBe(1);
    expect(delivered).toHaveLength(1);
  });
  it.each(["DRAFT", "CANCELLED"] as const)("does not treat %s reservations as occupied", async status => {
    await db.reservation.create({ data: { patientId, doctorId, serviceId, status,
      startsAt: new Date(payload().startsAt), endsAt: new Date("2030-02-04T08:30:00Z") } });
    await request(app()).post("/reservations").send(payload()).expect(201);
  });
  it("allows the same time for two different doctors", async () => {
    const other = await db.doctor.create({ data: { name: "Second doctor" } });
    try {
      const otherService = await db.service.create({ data: { doctorId: other.id, name: "Consultation", durationMinutes: 30 } });
      await db.workingWindow.create({ data: { doctorId: other.id, weekday: 1, startMinute: 480, endMinute: 960 } });
      const api = app();
      await request(api).post("/reservations").send(payload()).expect(201);
      await request(api).post("/reservations").send({ ...payload(), doctorId: other.id, serviceId: otherService.id }).expect(201);
      expect(await db.reservation.count({ where: { patientId, status: "CONFIRMED" } })).toBe(2);
    } finally {
      await db.reservation.deleteMany({ where: { doctorId: other.id } });
      await db.workingWindow.deleteMany({ where: { doctorId: other.id } });
      await db.service.deleteMany({ where: { doctorId: other.id } });
      await db.doctor.delete({ where: { id: other.id } });
    }
  });
  it("notifies only after the committed reservation is visible to a separate client", async () => {
    const reader = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    let observedStatus: string | undefined;
    try {
      const api = createApp({ db, now, notifications: { async sendReservationConfirmation(message) {
        observedStatus = (await reader.reservation.findUnique({ where: { id: message.reservationId } }))?.status;
      } } });
      await request(api).post("/reservations").send(payload()).expect(201);
      expect(observedStatus).toBe("CONFIRMED");
    } finally { await reader.$disconnect(); }
  });
  it("keeps HTTP 201 and the confirmed record if notification fails", async () => {
    const warnings: unknown[] = [];
    const api = createApp({ db, now, logger: { warn: entry => { warnings.push(entry); }, error: console.error }, notifications: { async sendReservationConfirmation() {
      throw new Error("simulated notification failure");
    } } });
    const response = await request(api).post("/reservations").send(payload()).expect(201);
    expect(await db.reservation.findUnique({ where: { id: response.body.id } })).toMatchObject({ status: "CONFIRMED" });
    expect(warnings).toEqual([{ event: "notification_failed", reservationId: response.body.id }]);
  });
});

describe("Database invariants even without HTTP validation", () => {
  it("rejects overlapping confirmed writes directly in PostgreSQL", async () => {
    const data = { patientId, doctorId, serviceId, status: "CONFIRMED" as const,
      startsAt: new Date("2030-02-04T08:00:00Z"), endsAt: new Date("2030-02-04T08:30:00Z") };
    await db.reservation.create({ data });
    await expect(db.reservation.create({ data })).rejects.toThrow();
  });
  it("rejects zero-length appointments", async () => {
    const time = new Date("2030-02-04T08:00:00Z");
    await expect(db.reservation.create({ data: { patientId, doctorId, serviceId,
      startsAt: time, endsAt: time } })).rejects.toThrow();
  });
  it("rejects invalid working windows", async () => {
    await expect(db.workingWindow.create({ data: { doctorId, weekday: 0, startMinute: 0, endMinute: 1500 } })).rejects.toThrow();
  });
  it("rejects invalid service duration", async () => {
    await expect(db.service.update({ where: { id: serviceId }, data: { durationMinutes: 0 } })).rejects.toThrow();
  });
});
