import express, { type ErrorRequestHandler } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import type { NotificationService } from "./notifications/notification-service.js";
import { reservationInput } from "./reservations/input.js";
import { createConfirmedReservation } from "./reservations/create.js";
import { ReservationError } from "./reservations/errors.js";

export interface AppDependencies {
  db: PrismaClient;
  notifications: NotificationService;
  now?: () => Date;
  logger?: Pick<Console, "warn" | "error">;
}
export function createApp({ db, notifications, now = () => new Date(), logger = console }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.get("/health", (_request, response) => { response.json({ status: "ok", service: "bookerdoc-api" }); });
  app.post("/reservations", async (request, response) => {
    const parsed = reservationInput.safeParse(request.body);
    if (!parsed.success) throw new ReservationError(400, "INVALID_INPUT");
    const { reservation, confirmation } = await createConfirmedReservation(db, parsed.data, now);
    // $transaction has resolved: the confirmation is visible to other DB clients.
    try { await notifications.sendReservationConfirmation(confirmation); }
    catch { logger.warn({ event: "notification_failed", reservationId: reservation.id }); }
    response.status(201).json({ id: reservation.id, status: reservation.status,
      startsAt: reservation.startsAt.toISOString(), endsAt: reservation.endsAt.toISOString() });
  });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ReservationError) {
      response.status(error.status).json({ error: { code: error.code } });
    } else if (error?.type === "entity.parse.failed") {
      response.status(400).json({ error: { code: "INVALID_INPUT" } });
    } else if (error?.type === "entity.too.large") {
      response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE" } });
    } else {
      logger.error(error);
      response.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    }
  };
  app.use(errors);
  return app;
}
