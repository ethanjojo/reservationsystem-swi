import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { NotificationService, ReservationConfirmation } from "./notification-service.js";

/**
 * Notification Outbox (ADR-006): owns pending notification requests, their delivery state and retry.
 * Delivery is at-least-once; the provider must deduplicate by reservationId.
 */
const CONFIRMATION = "RESERVATION_CONFIRMED";

/** Must run inside the transaction that moves the reservation to CONFIRMED. */
export async function enqueueConfirmation(tx: Prisma.TransactionClient, message: ReservationConfirmation, availableAt: Date) {
  await tx.notificationOutbox.create({ data: { reservationId: message.reservationId, kind: CONFIRMATION,
    nextAttemptAt: availableAt, payload: { ...message, startsAt: message.startsAt.toISOString(), endsAt: message.endsAt.toISOString() } } });
}

// Provisional values (ADR-006): no requirement source yet; confirm with the real provider.
export interface DispatchOptions {
  now?: () => Date;
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
  retryDelayMs?: (attempt: number) => number;
  logger?: Pick<Console, "warn">;
}
const defaultRetryDelay = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
type Claimed = { id: string; payload: Record<string, string>; attempts: number };

export async function dispatchPendingNotifications(db: PrismaClient, notifications: NotificationService, {
  now = () => new Date(), batchSize = 10, maxAttempts = 8, leaseMs = 60_000, retryDelayMs = defaultRetryDelay, logger = console,
}: DispatchOptions = {}) {
  const time = now();
  // The lease keeps a claimed row invisible to other dispatchers while it is being sent; a crash releases it after leaseMs.
  const claimed = await db.$queryRaw<Claimed[]>`
    UPDATE "NotificationOutbox" SET "attempts" = "attempts" + 1, "nextAttemptAt" = ${new Date(time.getTime() + leaseMs)}
    WHERE "id" IN (
      SELECT "id" FROM "NotificationOutbox" WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${time}
      ORDER BY "createdAt" LIMIT ${batchSize} FOR UPDATE SKIP LOCKED)
    RETURNING "id", "payload", "attempts"`;
  const result = { sent: 0, retried: 0, failed: 0 };
  for (const row of claimed) {
    const { reservationId, recipient, doctorName, serviceName, startsAt, endsAt } = row.payload;
    try {
      await notifications.sendReservationConfirmation({ reservationId: reservationId!, recipient: recipient!, doctorName: doctorName!,
        serviceName: serviceName!, startsAt: new Date(startsAt!), endsAt: new Date(endsAt!) });
      await db.notificationOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: now(), lastError: null } });
      result.sent++;
    } catch (error) {
      const exhausted = row.attempts >= maxAttempts;
      await db.notificationOutbox.update({ where: { id: row.id }, data: {
        status: exhausted ? "FAILED" : "PENDING", lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown",
        nextAttemptAt: new Date(time.getTime() + retryDelayMs(row.attempts)) } });
      logger.warn({ event: "notification_failed", reservationId, attempts: row.attempts, final: exhausted });
      if (exhausted) result.failed++; else result.retried++;
    }
  }
  return result;
}

/** Runtime activity in the API process (G4); runs never overlap. */
export function startOutboxDispatcher(db: PrismaClient, notifications: NotificationService,
  { intervalMs = 2_000, ...options }: DispatchOptions & { intervalMs?: number } = {}) {
  let running: Promise<unknown> = Promise.resolve();
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    running = dispatchPendingNotifications(db, notifications, options)
      .catch(error => console.error({ event: "outbox_dispatch_error", error }))
      .finally(() => { busy = false; });
  }, intervalMs);
  return { async stop() { clearInterval(timer); await running; } };
}
