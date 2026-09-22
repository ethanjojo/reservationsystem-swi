import express, { type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import type { PrismaClient, Reservation } from "./generated/prisma/client.js";
import type { NotificationService } from "./notifications/notification-service.js";
import type { Actor } from "./actors.js";
import { reservationInput } from "./reservations/input.js";
import { createDraft, checkAvailability, changeReservation, readReservation } from "./reservations/create.js";
import { ReservationError } from "./reservations/errors.js";
export interface AppDependencies {
  db: PrismaClient; notifications: NotificationService; now?: () => Date;
  actors?: ReadonlyMap<string, Actor>; logger?: Pick<Console, "warn" | "error">;
}
function output(row: Reservation) { return { id: row.id, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt,
  approvalRequestedAt: row.approvalRequestedAt, approvalExpiresAt: row.approvalExpiresAt }; }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ReservationError(400, "INVALID_INPUT");
  return result.data;
}
const availabilityInput = reservationInput.omit({ patientId: true });
export function createApp({ db, notifications, now = () => new Date(), actors = new Map(), logger = console }: AppDependencies) {
  const app = express(); app.disable("x-powered-by"); app.use(express.json({ limit: "16kb" }));
  const actor = (req: Request) => {
    const header = req.header("authorization");
    const identity = header?.startsWith("Bearer ") ? actors.get(header.slice(7)) : undefined;
    if (!identity) throw new ReservationError(401, "UNAUTHORIZED");
    return identity;
  };
  app.get("/health", (_req, res) => { res.json({ status: "ok", service: "bookerdoc-api" }); });
  app.post("/reservations", async (req, res) => {
    const identity = actor(req); const input = parse(reservationInput, req.body);
    res.status(201).json(output(await createDraft(db, input, identity, now)));
  });
  app.get("/availability", async (req, res) => {
    actor(req); res.json(await checkAvailability(db, parse(availabilityInput, req.query), now));
  });
  app.get("/reservations/:id", async (req, res) => {
    const identity = actor(req); res.json(output(await readReservation(db, parse(z.uuid(), req.params.id), identity, now)));
  });
  for (const operation of ["confirm", "cancel", "approve", "reject"] as const) {
    app.post(`/reservations/:id/${operation}`, async (req, res) => {
      const identity = actor(req); parse(z.strictObject({}), req.body ?? {});
      const result = await changeReservation(db, parse(z.uuid(), req.params.id), identity, operation, now);
      if (result.confirmation) {
        try { await notifications.sendReservationConfirmation(result.confirmation); }
        catch { logger.warn({ event: "notification_failed", reservationId: result.reservation.id }); }
      }
      res.json(output(result.reservation));
    });
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ReservationError) res.status(error.status).json({ error: { code: error.code } });
    else if (error?.type === "entity.parse.failed") res.status(400).json({ error: { code: "INVALID_INPUT" } });
    else if (error?.type === "entity.too.large") res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE" } });
    else { logger.error(error); res.status(500).json({ error: { code: "INTERNAL_ERROR" } }); }
  };
  app.use(errors); return app;
}
