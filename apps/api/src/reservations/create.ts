import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { ReservationInput } from "./input.js";
import { ReservationError } from "./errors.js";
import { fitsWorkingWindow } from "./scheduling.js";
import { requirePatient, type Actor } from "../actors.js";

type Transaction = Prisma.TransactionClient;
export type IntervalInput = Pick<ReservationInput, "doctorId" | "serviceId" | "startsAt">;
async function interval(tx: Transaction, input: IntervalInput, now: Date, storedEnd?: Date) {
  const doctor = await tx.doctor.findUnique({ where: { id: input.doctorId }, include: { workingWindows: true } });
  const service = await tx.service.findUnique({ where: { id: input.serviceId } });
  if (!doctor || !service) throw new ReservationError(404, "RESOURCE_NOT_FOUND");
  if (service.doctorId !== doctor.id) throw new ReservationError(400, "SERVICE_DOCTOR_MISMATCH");
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() <= now.getTime()) throw new ReservationError(400, "START_MUST_BE_FUTURE");
  const endsAt = storedEnd ?? new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const duration = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  return { doctor, service, startsAt, endsAt, fits: fitsWorkingWindow(startsAt, duration, doctor.workingWindows) };
}
export async function createDraft(db: PrismaClient, input: ReservationInput, actor: Actor, now: () => Date) {
  requirePatient(actor, input.patientId);
  return db.$transaction(async tx => {
    if (!await tx.user.findUnique({ where: { id: input.patientId } })) throw new ReservationError(404, "RESOURCE_NOT_FOUND");
    const checked = await interval(tx, input, now());
    if (!checked.fits) throw new ReservationError(400, "OUTSIDE_WORKING_WINDOW");
    return tx.reservation.create({ data: { patientId: input.patientId, doctorId: input.doctorId, serviceId: input.serviceId,
      startsAt: checked.startsAt, endsAt: checked.endsAt, status: "DRAFT" } });
  });
}
export async function checkAvailability(db: PrismaClient, input: IntervalInput, now: () => Date) {
  return db.$transaction(async tx => {
    const checked = await interval(tx, input, now());
    const overlap = checked.fits && await tx.reservation.findFirst({ where: { doctorId: input.doctorId, status: "CONFIRMED",
      startsAt: { lt: checked.endsAt }, endsAt: { gt: checked.startsAt } }, select: { id: true } });
    return { available: checked.fits && !overlap, startsAt: checked.startsAt, endsAt: checked.endsAt };
  });
}
export async function readReservation(db: PrismaClient, id: string, actor: Actor) {
  const row = await db.reservation.findUnique({ where: { id } });
  if (!row) throw new ReservationError(404, "RESERVATION_NOT_FOUND");
  if (!(actor.role === "patient" && actor.id === row.patientId) && !(actor.role === "doctor" && actor.id === row.doctorId)) {
    throw new ReservationError(403, "FORBIDDEN");
  }
  return row;
}
export async function changeReservation(db: PrismaClient, id: string, actor: Actor, operation: "confirm" | "cancel", now: () => Date) {
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const row = await tx.reservation.findUnique({ where: { id } });
      if (!row) throw new ReservationError(404, "RESERVATION_NOT_FOUND");
      requirePatient(actor, row.patientId);
      const time = now(); // authoritative time sampled after acquiring the state lock
      if (operation === "cancel") {
        if (row.status === "CANCELLED") return { reservation: row, confirmation: null };
        if (row.status === "CONFIRMED" && row.startsAt.getTime() - time.getTime() < 86_400_000) {
          throw new ReservationError(409, "CANCELLATION_TOO_LATE");
        }
        return { reservation: await tx.reservation.update({ where: { id }, data: { status: "CANCELLED" } }), confirmation: null };
      }
      if (row.status !== "DRAFT") throw new ReservationError(409, "INVALID_STATE");
      const checked = await interval(tx, { ...row, startsAt: row.startsAt.toISOString() }, time, row.endsAt);
      if (!checked.fits) throw new ReservationError(400, "OUTSIDE_WORKING_WINDOW");
      const patient = await tx.user.findUniqueOrThrow({ where: { id: row.patientId } });
      const reservation = await tx.reservation.update({ where: { id }, data: { status: "CONFIRMED" } });
      return { reservation, confirmation: { reservationId: id, recipient: patient.email, doctorName: checked.doctor.name,
        serviceName: checked.service.name, startsAt: row.startsAt, endsAt: row.endsAt } };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2039" &&
        `${error.message} ${JSON.stringify(error.meta)}`.includes("reservation_no_overlap")) throw new ReservationError(409, "RESERVATION_CONFLICT");
    throw error;
  }
}
