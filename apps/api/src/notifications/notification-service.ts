/** Notification Gateway port: the only place that knows the provider contract. The demo uses a stub, not real email. */
export interface ReservationConfirmation {
  reservationId: string;
  recipient: string;
  doctorName: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface NotificationService {
  /** Called only by the outbox dispatcher (ADR-006), after commit. May be retried: implementations must deduplicate by reservationId. */
  sendReservationConfirmation(message: ReservationConfirmation): Promise<void>;
}
