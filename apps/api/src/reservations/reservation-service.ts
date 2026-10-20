import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { ReservationInput } from "./input.js";
import type { Actor } from "../actors.js";
import { ReservationError } from "./errors.js";
import { scheduleInterval } from "./availability.js";
import { INITIAL_STATE, reservationLifecycle, authorizeCreate, canRead, expireIfDue, isAllocation,
  type Operation } from "./lifecycle.js";
import { enqueueConfirmation } from "../notifications/outbox.js";

/**
 * Reservation Service: one transaction per command, row lock (BR-06), authoritative time sampled after the lock.
 * Applies decisions of Reservation Lifecycle; never decides a transition itself (ADR-007).
 */
type Transaction = Prisma.TransactionClient;
export async function createDraft(db: PrismaClient, input: ReservationInput, actor: Actor, now: () => Date) {
  authorizeCreate(actor, input.patientId);
  return db.$transaction(async tx => {
    if (!await tx.user.findUnique({ where: { id: input.patientId } })) throw new ReservationError(404, "RESOURCE_NOT_FOUND");
    const checked = await scheduleInterval(tx, input, now());
    if (!checked.fits) throw new ReservationError(400, "OUTSIDE_WORKING_WINDOW");
    return tx.reservation.create({ data: { patientId: input.patientId, doctorId: input.doctorId, serviceId: input.serviceId,
      startsAt: checked.startsAt, endsAt: checked.endsAt, ...INITIAL_STATE } });
  });
}
async function lockedReservation(tx: Transaction, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = await tx.reservation.findUnique({ where: { id } });
  if (!row) throw new ReservationError(404, "RESERVATION_NOT_FOUND");
  return row;
}
export async function readReservation(db: PrismaClient, id: string, actor: Actor, now: () => Date) {
  return db.$transaction(async tx => {
    const row = await lockedReservation(tx, id);
    if (!canRead(actor, row)) throw new ReservationError(403, "FORBIDDEN");
    const expiry = expireIfDue(row, now());
    return expiry ? tx.reservation.update({ where: { id }, data: expiry }) : row;
  });
}
export async function changeReservation(db: PrismaClient, id: string, actor: Actor, operation: Operation, now: () => Date) {
  try {
    const result = await db.$transaction(async tx => {
      const row = await lockedReservation(tx, id);
      const time = now(); // authoritative time sampled after acquiring the state lock
      const command = { row, actor, operation, time };
      let decision = reservationLifecycle.evaluate(command);
      let schedule: Awaited<ReturnType<typeof scheduleInterval>> | undefined;
      if (decision.kind === "needsSchedule") {
        schedule = await scheduleInterval(tx, { ...row, startsAt: row.startsAt.toISOString() }, time, row.endsAt);
        decision = reservationLifecycle.evaluate({ ...command,
          schedule: { fits: schedule.fits, requiresApproval: schedule.doctor.requiresApproval } });
      }
      if (decision.kind === "expire") {
        await tx.reservation.update({ where: { id }, data: decision.change });
        // Return a marker: throwing inside the transaction would undo expiration.
        return { expired: true as const };
      }
      if (decision.kind === "unchanged") return { reservation: row };
      if (decision.kind === "needsSchedule") throw new Error("Lifecycle requires schedule despite supplied facts");
      const change = decision.change;
      const reservation = await tx.reservation.update({ where: { id }, data: change });
      if (isAllocation(change)) {
        if (!schedule) throw new Error("Allocation requires validated schedule");
        // ADR-006: the notification request commits atomically with CONFIRMED and rolls back with a BR-02 conflict.
        const patient = await tx.user.findUniqueOrThrow({ where: { id: row.patientId } });
        await enqueueConfirmation(tx, { reservationId: id, recipient: patient.email, doctorName: schedule.doctor.name,
          serviceName: schedule.service.name, startsAt: row.startsAt, endsAt: row.endsAt }, time);
      }
      return { reservation };
    });
    if ("expired" in result) throw new ReservationError(409, "APPROVAL_EXPIRED");
    return result.reservation;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2039" &&
        `${error.message} ${JSON.stringify(error.meta)}`.includes("reservation_no_overlap")) throw new ReservationError(409, "RESERVATION_CONFLICT");
    throw error;
  }
}
