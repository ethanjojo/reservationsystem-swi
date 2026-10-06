import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { ReservationInput } from "./input.js";
import { ReservationError } from "./errors.js";
import { fitsWorkingWindow } from "./scheduling.js";
import { BLOCKING_STATUS } from "./lifecycle.js";

/** Scheduling & Availability: BR-01 interval and BR-04 working windows. */
export type IntervalInput = Pick<ReservationInput, "doctorId" | "serviceId" | "startsAt">;
export async function scheduleInterval(tx: Prisma.TransactionClient, input: IntervalInput, now: Date, storedEnd?: Date) {
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
export async function checkAvailability(db: PrismaClient, input: IntervalInput, now: () => Date) {
  return db.$transaction(async tx => {
    const checked = await scheduleInterval(tx, input, now());
    const overlap = checked.fits && await tx.reservation.findFirst({ where: { doctorId: input.doctorId, status: BLOCKING_STATUS,
      startsAt: { lt: checked.endsAt }, endsAt: { gt: checked.startsAt } }, select: { id: true } });
    return { available: checked.fits && !overlap, startsAt: checked.startsAt, endsAt: checked.endsAt };
  });
}
