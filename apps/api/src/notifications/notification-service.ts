/** Boundary contract for CP1. C01 does not send real email. */
export interface ReservationConfirmation {
  reservationId: string;
  recipient: string;
  doctorName: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface NotificationService {
  /** Call after the reservation transaction commits. Rejection does not cancel it. */
  sendReservationConfirmation(message: ReservationConfirmation): Promise<void>;
}
