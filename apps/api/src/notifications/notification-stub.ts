import type { NotificationService } from "./notification-service.js";

/** Local CP1 boundary; records the request, never sends email or logs its content. */
export function createNotificationStub(logger: Pick<Console, "info"> = console): NotificationService {
  return { async sendReservationConfirmation(message) {
    logger.info({ event: "notification_stub_accepted", reservationId: message.reservationId });
  } };
}
