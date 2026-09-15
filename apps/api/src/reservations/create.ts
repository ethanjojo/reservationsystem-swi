import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { ReservationInput } from "./input.js";
import { ReservationError } from "./errors.js";
import { fitsWorkingWindow } from "./scheduling.js";
import { createReservationRepository } from "./repository.js";

export async function createConfirmedReservation(db: PrismaClient, input: ReservationInput, now: () => Date) {
  try {
    return await db.$transaction(async tx => {
      // A transaction has one connection: run these queries sequentially.
      const patient = await tx.user.findUnique({ where: { id: input.patientId } });
      const doctor = await tx.doctor.findUnique({ where: { id: input.doctorId }, include: { workingWindows: true } });
      const service = await tx.service.findUnique({ where: { id: input.serviceId } });
      if (!patient || !doctor || !service) throw new ReservationError(404, "RESOURCE_NOT_FOUND");
      if (service.doctorId !== doctor.id) throw new ReservationError(400, "SERVICE_DOCTOR_MISMATCH");
      const startsAt = new Date(input.startsAt);
      if (startsAt.getTime() <= now().getTime()) throw new ReservationError(400, "START_MUST_BE_FUTURE");
      if (!fitsWorkingWindow(startsAt, service.durationMinutes, doctor.workingWindows)) {
        throw new ReservationError(400, "OUTSIDE_WORKING_WINDOW");
      }
      const reservation = await createReservationRepository(tx).create({
        patientId: patient.id, doctorId: doctor.id, serviceId: service.id,
        startsAt, endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60_000), status: "CONFIRMED",
      });
      return { reservation, confirmation: { reservationId: reservation.id, recipient: patient.email,
        doctorName: doctor.name, serviceName: service.name, startsAt: reservation.startsAt, endsAt: reservation.endsAt } };
    });
  } catch (error) {
    // Match this constraint only; unrelated DB failures must stay server errors.
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2039" &&
        `${error.message} ${JSON.stringify(error.meta)}`.includes("reservation_no_overlap")) {
      throw new ReservationError(409, "RESERVATION_CONFLICT");
    }
    throw error;
  }
}
