import type { PrismaClient, Reservation, ReservationStatus } from "../generated/prisma/client.js";

export interface NewReservation {
  patientId: string;
  doctorId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
}

/** Persistence only; createConfirmedReservation owns confirmation and business validation. */
export function createReservationRepository(db: Pick<PrismaClient, "reservation">) {
  return {
    async create(input: NewReservation): Promise<Reservation> {
      return db.reservation.create({ data: input });
    },
    async findById(id: string): Promise<Reservation | null> {
      return db.reservation.findUnique({ where: { id } });
    },
  };
}
