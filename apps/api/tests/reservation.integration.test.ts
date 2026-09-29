import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createReservationRepository } from "../src/reservations/repository.js";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/bookerdoc_test") {
  throw new Error("Use npm test with a dedicated bookerdoc_test PostgreSQL database.");
}
const connect = () => new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

describe("Reservation persistence against real PostgreSQL", () => {
  it("persists identity, relationships, precise times and status across client connections", async () => {
    const writer = connect();
    const reader = connect();
    const patientId = randomUUID();
    const doctorId = randomUUID();
    const serviceId = randomUUID();
    try {
      const database = await writer.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
      expect(database[0]?.name).toBe("bookerdoc_test");
      await writer.user.create({ data: { id: patientId, name: "Test Patient", email: `${patientId}@example.test` } });
      await writer.doctor.create({ data: { id: doctorId, name: "Test Doctor" } });
      await writer.service.create({ data: { id: serviceId, doctorId, name: "Consultation", durationMinutes: 30 } });
      const input = {
        patientId, doctorId, serviceId,
        startsAt: new Date("2030-02-04T09:00:00.123+01:00"),
        endsAt: new Date("2030-02-04T09:30:00.123+01:00"),
        status: "CONFIRMED" as const,
      };
      const saved = await createReservationRepository(writer).create(input);
      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
      await writer.$disconnect();
      const loaded = await createReservationRepository(reader).findById(saved.id);
      expect(loaded).toEqual({ ...input, id: saved.id, createdAt: saved.createdAt, approvalRequestedAt: null, approvalExpiresAt: null });
      expect(loaded?.startsAt.toISOString()).toBe("2030-02-04T08:00:00.123Z");
      expect(loaded?.endsAt.toISOString()).toBe("2030-02-04T08:30:00.123Z");
      expect(loaded?.createdAt).toBeInstanceOf(Date);

      // Stored appointment times must not change when the service duration changes.
      await reader.service.update({ where: { id: serviceId }, data: { durationMinutes: 45 } });
      expect(await createReservationRepository(reader).findById(saved.id)).toEqual(loaded);
      expect(await createReservationRepository(reader).findById(randomUUID())).toBeNull();
    } finally {
      try {
        await reader.$transaction([
          reader.reservation.deleteMany({ where: { patientId } }),
          reader.service.deleteMany({ where: { id: serviceId } }),
          reader.doctor.deleteMany({ where: { id: doctorId } }),
          reader.user.deleteMany({ where: { id: patientId } }),
        ]);
      } finally {
        await Promise.all([writer.$disconnect(), reader.$disconnect()]);
      }
    }
  }, 15_000);

  it("enforces reservation CHECK and EXCLUDE constraints directly in PostgreSQL", async () => {
    const db = connect();
    const patientId = randomUUID();
    const doctorId = randomUUID();
    const serviceId = randomUUID();
    try {
      await db.user.create({ data: { id: patientId, name: "Test Patient", email: `${patientId}@example.test` } });
      await db.doctor.create({ data: { id: doctorId, name: "Test Doctor" } });
      await db.service.create({ data: { id: serviceId, doctorId, name: "Consultation", durationMinutes: 30 } });

      await expect(createReservationRepository(db).create({
        patientId,
        doctorId,
        serviceId,
        startsAt: new Date("2030-02-04T09:30:00Z"),
        endsAt: new Date("2030-02-04T09:00:00Z"),
        status: "CONFIRMED",
      })).rejects.toThrow(/reservation_positive_interval/);

      await createReservationRepository(db).create({
        patientId,
        doctorId,
        serviceId,
        startsAt: new Date("2030-02-04T09:00:00Z"),
        endsAt: new Date("2030-02-04T09:30:00Z"),
        status: "CONFIRMED",
      });
      await expect(createReservationRepository(db).create({
        patientId,
        doctorId,
        serviceId,
        startsAt: new Date("2030-02-04T09:15:00Z"),
        endsAt: new Date("2030-02-04T09:45:00Z"),
        status: "CONFIRMED",
      })).rejects.toThrow(/reservation_no_overlap/);
    } finally {
      try {
        await db.$transaction([
          db.reservation.deleteMany({ where: { patientId } }),
          db.service.deleteMany({ where: { id: serviceId } }),
          db.doctor.deleteMany({ where: { id: doctorId } }),
          db.user.deleteMany({ where: { id: patientId } }),
        ]);
      } finally {
        await db.$disconnect();
      }
    }
  });
});
