import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createApp } from "../src/app.js";
import type { NotificationService, ReservationConfirmation } from "../src/notifications/notification-service.js";
import { dispatchPendingNotifications } from "../src/notifications/outbox.js";

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
  ["other-doctor", { role: "doctor" as const, id: "00000000-0000-4000-8000-000000000098" }],
  ["doctor", { role: "doctor" as const, id: doctorId }],
]) });
const quiet = { warn() {} };
const recorder: NotificationService = { async sendReservationConfirmation(message) { delivered.push(message); } };
/** Runs the outbox dispatcher once (ADR-006) and returns everything delivered so far. */
const deliver = async (gateway = recorder) => {
  await dispatchPendingNotifications(db, gateway, { now: () => instant, logger: quiet }); return delivered;
};
const outbox = () => db.notificationOutbox.findMany({ where: { reservation: { patientId } }, orderBy: { createdAt: "asc" } });
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
    expect(draft.status).toBe("DRAFT"); expect(await deliver()).toEqual([]);
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
    expect(await deliver()).toHaveLength(1);
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
    expect(await deliver()).toHaveLength(1);
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
    const expected = { id: draft.id, status: "DRAFT", startsAt: draft.startsAt, endsAt: draft.endsAt,
      approvalRequestedAt: null, approvalExpiresAt: null };
    await get(`/reservations/${draft.id}`).expect(200, expected);
    await get(`/reservations/${draft.id}`, "doctor").expect(200, expected);
  });
  it("other patients cannot read, confirm or cancel a reservation", async () => {
    const draft = await create();
    await post(`/reservations/${draft.id}/confirm`, {}, "other").expect(403);
    await post(`/reservations/${draft.id}/cancel`, {}, "other").expect(403);
    await request(app()).get(`/reservations/${draft.id}`).set("Authorization", "Bearer other").expect(403);
  });
  it("records the notification request with CONFIRMED; provider failure preserves success and is retried", async () => {
    const draft = await create(); let observed: string | undefined;
    await confirm(draft.id).expect(200);
    expect(await outbox()).toMatchObject([{ reservationId: draft.id, status: "PENDING", attempts: 0 }]);
    const failing: NotificationService = { async sendReservationConfirmation(message) {
      observed = (await db.reservation.findUniqueOrThrow({ where: { id: message.reservationId } })).status;
      throw new Error("simulated failure");
    } };
    await deliver(failing);
    expect(observed).toBe("CONFIRMED");
    const [retry] = await outbox();
    expect(retry).toMatchObject({ status: "PENDING", attempts: 1, lastError: "simulated failure" });
    expect(retry!.nextAttemptAt).toEqual(new Date(instant.getTime() + 30_000));
    expect(await deliver()).toHaveLength(0); // not due before the backoff elapses
    instant = new Date(instant.getTime() + 30_000);
    expect(await deliver()).toMatchObject([{ reservationId: draft.id, recipient: `${patientId}@example.test`,
      doctorName: "Doctor", serviceName: "Consultation", startsAt: new Date(draft.startsAt), endsAt: new Date(draft.endsAt) }]);
    expect(await outbox()).toMatchObject([{ status: "SENT", attempts: 2 }]);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("CONFIRMED");
  });
});


describe("C02 baseline v0.2 — approval, rejection and expiry", () => {
  beforeEach(async () => {
    await db.doctor.update({ where: { id: doctorId }, data: { requiresApproval: true } });
  });
  const approve = (id: string, token = "doctor") => post(`/reservations/${id}/approve`, {}, token);
  const reject = (id: string, token = "doctor") => post(`/reservations/${id}/reject`, {}, token);
  const read = (id: string, token = "patient") => request(app()).get(`/reservations/${id}`).set("Authorization", `Bearer ${token}`);
  const pending = async () => { const row = await create(); return (await confirm(row.id).expect(200)).body; };

  it("REQ-07: persists a nonblocking request with a 24h deadline and no confirmation email", async () => {
    const row = await pending();
    expect(row).toMatchObject({ status: "PENDING_APPROVAL", approvalRequestedAt: "2030-01-01T00:00:00.000Z", approvalExpiresAt: "2030-01-02T00:00:00.000Z" });
    expect((await availability().expect(200)).body.available).toBe(true);
    expect(await deliver()).toHaveLength(0);
    await confirm(row.id).expect(409);
    expect((await read(row.id, "doctor").expect(200)).body.status).toBe("PENDING_APPROVAL");
  });
  it("REQ-08: only the owning doctor can approve, exactly once", async () => {
    const row = await pending();
    await approve(row.id, "patient").expect(403); await approve(row.id, "other-doctor").expect(403);
    await reject(row.id, "patient").expect(403); await reject(row.id, "other-doctor").expect(403);
    await read(row.id, "other-doctor").expect(403);
    instant = new Date("2030-01-01T01:00:00Z"); // delayed decision remains valid
    expect((await approve(row.id).expect(200)).body.status).toBe("CONFIRMED");
    expect((await availability().expect(200)).body.available).toBe(false);
    await approve(row.id).expect(409); await reject(row.id).expect(409);
    expect(await deliver()).toHaveLength(1);
  });
  it("REQ-09: concurrent conflicting approvals confirm one and preserve the other request", async () => {
    const a = await pending(), b = await pending();
    const results = await Promise.all([approve(a.id), approve(b.id)]);
    expect(results.map(r => r.status).sort()).toEqual([200,409]);
    const rows = await db.reservation.findMany({ where: { patientId } });
    expect(rows.map(r => r.status).sort()).toEqual(["CONFIRMED", "PENDING_APPROVAL"]);
    expect(await deliver()).toHaveLength(1);
  });
  it("REQ-10: rejection is persistent and terminal without allocation or notification", async () => {
    const row = await pending();
    expect((await reject(row.id).expect(200)).body.status).toBe("REJECTED");
    expect((await read(row.id).expect(200)).body.status).toBe("REJECTED");
    await reject(row.id).expect(409); await approve(row.id).expect(409); await cancel(row.id).expect(409);
    expect((await availability().expect(200)).body.available).toBe(true);
    expect(await deliver()).toHaveLength(0);
  });
  it("REQ-11: deadline is exact and survives a fresh app instance", async () => {
    const row = await pending();
    instant = new Date("2030-01-01T23:59:59.999Z");
    expect((await read(row.id).expect(200)).body.status).toBe("PENDING_APPROVAL");
    instant = new Date("2030-01-02T00:00:00Z");
    // read() constructs a fresh Express app; expiry comes from persisted metadata.
    expect((await read(row.id).expect(200)).body.status).toBe("EXPIRED");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("EXPIRED");
    await approve(row.id).expect(409); await reject(row.id).expect(409); await cancel(row.id).expect(409);
    expect((await availability().expect(200)).body.available).toBe(true);
    expect(await deliver()).toHaveLength(0);
  });
  it.each(["approve", "reject", "cancel", "confirm"])("REQ-11: %s commits expiry despite returning 409", async operation => {
    const row = await pending(); instant = new Date("2030-01-02T00:00:00Z");
    const token = operation === "approve" || operation === "reject" ? "doctor" : "patient";
    const result = await post(`/reservations/${row.id}/${operation}`, {}, token).expect(409);
    expect(result.body.error.code).toBe("APPROVAL_EXPIRED");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("EXPIRED");
  });
  it("caps waiting at the appointment and forbids approving at its start", async () => {
    instant = new Date("2030-02-04T07:00:00Z"); const row = await pending();
    expect(row.approvalExpiresAt).toBe("2030-02-04T08:00:00.000Z");
    instant = new Date("2030-02-04T08:00:00Z"); await approve(row.id).expect(409);
    expect((await read(row.id).expect(200)).body.status).toBe("EXPIRED");
  });
  it("allows pending cancellation less than 24h before start", async () => {
    instant = new Date("2030-02-04T07:00:00Z"); const row = await pending();
    expect((await cancel(row.id).expect(200)).body.status).toBe("CANCELLED");
    await approve(row.id).expect(409); await cancel(row.id).expect(200);
  });
  it("approval/cancel and approval/reject races have legal serial outcomes", async () => {
    const row = await pending();
    const results = await Promise.all([approve(row.id), cancel(row.id)]);
    expect(results[1]!.status).toBe(200); expect([200,409]).toContain(results[0]!.status);
    expect((await read(row.id).expect(200)).body.status).toBe("CANCELLED");
    const next = await pending();
    const decisions = await Promise.all([approve(next.id), reject(next.id)]);
    expect(decisions.map(r => r.status).sort()).toEqual([200,409]);
    expect(["CONFIRMED", "REJECTED"]).toContain((await read(next.id).expect(200)).body.status);
  });
  it("rechecks windows while preserving the original duration at approval", async () => {
    const row = await pending();
    await db.service.update({ where: { id: serviceId }, data: { durationMinutes: 60 } });
    expect((await approve(row.id).expect(200)).body.endsAt).toBe(row.endsAt);
    const next = await pending(); await db.workingWindow.deleteMany({ where: { doctorId } });
    await approve(next.id).expect(400);
    expect((await read(next.id).expect(200)).body.status).toBe("PENDING_APPROVAL");
  });
  it("unauthorized access cannot materialize expiry", async () => {
    const row = await pending(); instant = new Date("2030-01-02T00:00:00Z");
    await approve(row.id, "other-doctor").expect(403); await read(row.id, "other").expect(403);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING_APPROVAL");
  });
  it("REQ-11: approval samples time after waiting for the reservation lock", async () => {
    const row = await pending();
    instant = new Date("2030-01-01T23:59:59.999Z");
    let unlock!: () => void, acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${row.id}::uuid FOR UPDATE`;
      acquired(); await release;
    }, { timeout: 10_000 });
    await held;
    const decision = approve(row.id).then(response => response);
    try {
      // Wait for PostgreSQL to report the actual blocked request, not an arbitrary delay.
      await expect.poll(async () => {
        const waiting = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE 'SELECT "id" FROM "Reservation"%'
        `;
        return Number(waiting[0]!.count);
      }, { timeout: 3000 }).toBeGreaterThan(0);
      instant = new Date("2030-01-02T00:00:00Z");
    } finally { unlock(); await blocker; }
    const response = await decision;
    expect(response.status).toBe(409); expect(response.body.error.code).toBe("APPROVAL_EXPIRED");
    expect((await read(row.id).expect(200)).body.status).toBe("EXPIRED");
  });
  it("changing the source flag does not bypass approval for an existing request", async () => {
    const row = await pending();
    await db.doctor.update({ where: { id: doctorId }, data: { requiresApproval: false } });
    await confirm(row.id).expect(409);
    expect((await approve(row.id).expect(200)).body.status).toBe("CONFIRMED");
  });
});


describe("C03 ADR-006 — transactional notification outbox", () => {
  const failing: NotificationService = { async sendReservationConfirmation() { throw new Error("provider down"); } };
  it("a BR-02 conflict rolls back the notification request together with the state change", async () => {
    const first = await create(); await confirm(first.id).expect(200);
    const second = await create(); await confirm(second.id).expect(409);
    expect((await outbox()).map(row => row.reservationId)).toEqual([first.id]);
  });
  it("cancel, reject and pending approval never enqueue a notification", async () => {
    await db.doctor.update({ where: { id: doctorId }, data: { requiresApproval: true } });
    const a = await create(); await confirm(a.id).expect(200); await cancel(a.id).expect(200);
    const b = await create(); await confirm(b.id).expect(200); await post(`/reservations/${b.id}/reject`, {}, "doctor").expect(200);
    expect(await outbox()).toEqual([]);
  });
  it("exhausted retries mark FAILED and never change the reservation", async () => {
    const draft = await create(); await confirm(draft.id).expect(200);
    for (let attempt = 1; attempt <= 8; attempt++) {
      await dispatchPendingNotifications(db, failing, { now: () => instant, logger: quiet });
      instant = new Date(instant.getTime() + 3_600_000);
    }
    expect(await outbox()).toMatchObject([{ status: "FAILED", attempts: 8, lastError: "provider down" }]);
    await deliver(); expect(delivered).toHaveLength(0);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("CONFIRMED");
  });
  it("concurrent dispatchers deliver each request once (FOR UPDATE SKIP LOCKED)", async () => {
    const a = await create(); await confirm(a.id).expect(200);
    await cancel(a.id).expect(200); // frees the slot for b; a's request stays pending
    const b = await create(); await confirm(b.id).expect(200);
    const slow: NotificationService = { async sendReservationConfirmation(message) {
      await new Promise(resolve => setTimeout(resolve, 50)); delivered.push(message);
    } };
    await Promise.all([1, 2, 3].map(() => dispatchPendingNotifications(db, slow, { now: () => instant, logger: quiet })));
    expect(delivered.map(m => m.reservationId).sort()).toEqual([a.id, b.id].sort());
    expect((await outbox()).map(row => row.status)).toEqual(["SENT", "SENT"]);
  });
  it("a request survives a fresh process: a new dispatcher instance delivers it", async () => {
    const draft = await create(); await confirm(draft.id).expect(200);
    const fresh = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
    try { await dispatchPendingNotifications(fresh, recorder, { now: () => instant, logger: quiet }); }
    finally { await fresh.$disconnect(); }
    expect(delivered.map(m => m.reservationId)).toEqual([draft.id]);
  });
});
