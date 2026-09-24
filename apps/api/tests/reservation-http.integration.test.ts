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
let instant: Date;
const payload = () => ({ patientId, doctorId, serviceId, startsAt: "2030-02-04T09:00:00+01:00" });
const app = () => createApp({ db, now: () => instant, actors: new Map([
  ["patient", { role: "patient" as const, id: patientId }],
  ["other", { role: "patient" as const, id: "00000000-0000-4000-8000-000000000099" }],
  ["doctor", { role: "doctor" as const, id: doctorId }],
]), notifications: { async sendReservationConfirmation(message) { delivered.push(message); } } });
const post = (path: string, body = {}, token = "patient") => request(app()).post(path).set("Authorization", `Bearer ${token}`).send(body);
const get = (path: string, token = "patient") => request(app()).get(path).set("Authorization", `Bearer ${token}`);
const create = async () => (await post("/reservations", payload()).expect(201)).body;
const confirm = (id: string) => post(`/reservations/${id}/confirm`);
const cancel = (id: string) => post(`/reservations/${id}/cancel`);
const availability = (startsAt = payload().startsAt) => request(app()).get("/availability").set("Authorization", "Bearer patient")
  .query({ doctorId, serviceId, startsAt });

beforeEach(async () => {
  [patientId, doctorId, serviceId] = [randomUUID(), randomUUID(), randomUUID()];
  instant = new Date("2030-01-01T00:00:00Z"); delivered = [];
  await db.user.create({ data: { id: patientId, name: "Patient", email: `${patientId}@example.test` } });
  await db.doctor.create({ data: { id: doctorId, name: "Doctor" } });
  await db.service.create({ data: { id: serviceId, doctorId, name: "Consultation", durationMinutes: 30 } });
  await db.workingWindow.create({ data: { doctorId, weekday: 1, startMinute: 480, endMinute: 960 } });
});
afterEach(async () => {
  try { await db.$transaction([
    db.reservation.deleteMany({ where: { patientId } }), db.workingWindow.deleteMany({ where: { doctorId } }),
    db.service.deleteMany({ where: { doctorId } }), db.doctor.deleteMany({ where: { id: doctorId } }),
    db.user.deleteMany({ where: { id: patientId } }),
  ]); } finally { await db.$disconnect(); }
});

describe("C02 baseline v0.1 — actual HTTP and PostgreSQL", () => {
  it("REQ-01: creates a persistent DRAFT without allocation or notification", async () => {
    const draft = await create();
    expect(draft.status).toBe("DRAFT"); expect(delivered).toEqual([]);
    expect(await db.reservation.findUnique({ where: { id: draft.id } })).toMatchObject({ status: "DRAFT", patientId });
    expect((await availability().expect(200)).body.available).toBe(true);
  });
  it.each([
    { patientId: "bad" }, { startsAt: "2030-02-04T09:00:00" }, { startsAt: "2030-02-30T09:00:00Z" },
    { startsAt: "2029-02-04T09:00:00Z" }, { startsAt: "2030-02-04T09:00:00.0009+01:00" },
    { startsAt: "2030-02-04T09:01:00+01:00" }, { startsAt: "2030-02-04T15:45:00+01:00" },
    { startsAt: "2030-02-05T09:00:00+01:00" }, { status: "CONFIRMED" },
  ])("REQ-01: invalid create %j leaves no row", async patch => {
    await post("/reservations", { ...payload(), ...patch }).expect(400);
    expect(await db.reservation.count({ where: { patientId } })).toBe(0);
  });
  it("rejects missing identity and acting for another patient", async () => {
    await request(app()).post("/reservations").send(payload()).expect(401);
    await post("/reservations", payload(), "doctor").expect(403);
    await post("/reservations", payload(), "other").expect(403);
  });
  it("returns 404 for an unknown resource", async () => {
    await post("/reservations", { ...payload(), doctorId: randomUUID() }).expect(404);
  });
  it("REQ-02: availability is read-only and uses half-open intervals", async () => {
    const draft = await create(); await confirm(draft.id).expect(200);
    const before = await db.reservation.findMany({ where: { patientId } });
    expect((await availability("2030-02-04T08:30:00+01:00").expect(200)).body.available).toBe(true);
    expect((await availability("2030-02-04T09:15:00+01:00").expect(200)).body.available).toBe(false);
    expect((await availability("2030-02-04T09:30:00+01:00").expect(200)).body.available).toBe(true);
    expect((await availability("2030-02-04T16:00:00+01:00").expect(200)).body.available).toBe(false);
    expect(await db.reservation.findMany({ where: { patientId } })).toEqual(before);
    await availability("invalid").expect(400);
  });
  it("REQ-03: create ignores overlap, confirm rejects it and preserves DRAFT", async () => {
    const first = await create(); await confirm(first.id).expect(200);
    const second = await create(); await confirm(second.id).expect(409);
    expect(await db.reservation.findUnique({ where: { id: second.id } })).toMatchObject({ status: "DRAFT" });
    expect(delivered).toHaveLength(1);
  });
  it("REQ-04: concurrent conflicting confirms allocate at most once", async () => {
    const a = await create(), b = await create();
    const responses = await Promise.all([confirm(a.id), confirm(b.id)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.reservation.count({ where: { patientId, status: "CONFIRMED" } })).toBe(1);
  });
  it("same-reservation confirm race sends only one notification", async () => {
    const draft = await create();
    expect((await Promise.all([confirm(draft.id), confirm(draft.id)])).map(r => r.status).sort()).toEqual([200,409]);
    expect(delivered).toHaveLength(1);
  });
  it("confirms stored duration even after the service duration changes", async () => {
    const draft = await create();
    await db.service.update({ where: { id: serviceId }, data: { durationMinutes: 60 } });
    const result = await confirm(draft.id).expect(200);
    expect(result.body.endsAt).toBe(draft.endsAt);
  });
  it("revalidates future time and current windows at confirmation", async () => {
    const draft = await create();
    await db.workingWindow.deleteMany({ where: { doctorId } });
    await confirm(draft.id).expect(400);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
  });
  it("REQ-05: cancellation at exactly 24h releases the interval, is retained and idempotent", async () => {
    const draft = await create(); await confirm(draft.id).expect(200);
    instant = new Date("2030-02-03T08:00:00Z");
    expect((await cancel(draft.id).expect(200)).body.status).toBe("CANCELLED");
    await cancel(draft.id).expect(200); await confirm(draft.id).expect(409);
    expect((await availability().expect(200)).body.available).toBe(true);
    expect(await db.reservation.count({ where: { id: draft.id } })).toBe(1);
  });
  it("REQ-05: less than 24h rejects cancellation with unchanged CONFIRMED", async () => {
    const draft = await create(); await confirm(draft.id).expect(200);
    instant = new Date("2030-02-03T08:00:00.001Z");
    await cancel(draft.id).expect(409);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("CONFIRMED");
  });
  it("DRAFT can be cancelled even after its start, never physically deleted", async () => {
    const draft = await create(); instant = new Date("2031-01-01T00:00:00Z");
    expect((await cancel(draft.id).expect(200)).body.status).toBe("CANCELLED");
  });
  it("cancel/confirm race has a serializable business outcome", async () => {
    const draft = await create(); const results = await Promise.all([confirm(draft.id), cancel(draft.id)]);
    expect(results[1]!.status).toBe(200); expect([200,409]).toContain(results[0]!.status);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("CANCELLED");
  });
  it("owner patient and doctor can read reservation with contract fields", async () => {
    const draft = await create();
    const expected = { id: draft.id, status: "DRAFT", startsAt: draft.startsAt, endsAt: draft.endsAt };
    await get(`/reservations/${draft.id}`).expect(200, expected);
    await get(`/reservations/${draft.id}`, "doctor").expect(200, expected);
  });
  it("other patients cannot read, confirm or cancel a reservation", async () => {
    const draft = await create();
    await post(`/reservations/${draft.id}/confirm`, {}, "other").expect(403);
    await post(`/reservations/${draft.id}/cancel`, {}, "other").expect(403);
    await request(app()).get(`/reservations/${draft.id}`).set("Authorization", "Bearer other").expect(403);
  });
  it("only notifies after commit, and notification failure preserves success", async () => {
    const draft = await create(); let observed: string | undefined;
    const reader = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const api = createApp({ db, now: () => instant, actors: new Map([["patient", { role: "patient", id: patientId }]]),
        logger: { warn() {}, error: console.error }, notifications: { async sendReservationConfirmation(message) {
          observed = (await reader.reservation.findUniqueOrThrow({ where: { id: message.reservationId } })).status;
          throw new Error("simulated failure");
        } } });
      await request(api).post(`/reservations/${draft.id}/confirm`).set("Authorization", "Bearer patient").expect(200);
      expect(observed).toBe("CONFIRMED");
    } finally { await reader.$disconnect(); }
  });
});
