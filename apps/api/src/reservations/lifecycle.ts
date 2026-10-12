import type { Reservation, ReservationStatus } from "../generated/prisma/client.js";
import type { Actor } from "../actors.js";
import { ReservationError } from "./errors.js";

/**
 * Reservation Lifecycle (ADR-007): the single owner of statechart v0.2 and BR-03/05/08.
 * Pure — no I/O. Reservation Service locks and loads, asks for a decision and applies the returned StateChange.
 */
export type Operation = "confirm" | "cancel" | "approve" | "reject";
export type LifecycleView = Pick<Reservation, "status" | "patientId" | "doctorId" | "startsAt" | "approvalExpiresAt">;
export type StateChange = { status: ReservationStatus; approvalRequestedAt?: Date; approvalExpiresAt?: Date };
export type Decision =
  | { kind: "expire"; change: StateChange } // BR-08: committed even though the caller receives 409
  | { kind: "unchanged" }
  | { kind: "change"; change: StateChange }
  | { kind: "needsSchedule" }; // confirm/approve depend on current working windows (BR-04)
export type Schedule = { fits: boolean; requiresApproval: boolean };

const DAY_MS = 86_400_000;
export const INITIAL_STATE: StateChange = { status: "DRAFT" };
/** BR-02: the only state that allocates the Resource. */
export const BLOCKING_STATUS: ReservationStatus = "CONFIRMED";
const EXPIRED: StateChange = { status: "EXPIRED" };

// BR-05
export function authorizeCreate(actor: Actor, patientId: string) {
  if (actor.role !== "patient" || actor.id !== patientId) throw new ReservationError(403, "FORBIDDEN");
}
export function canRead(actor: Actor, row: LifecycleView) {
  return (actor.role === "patient" && actor.id === row.patientId) || (actor.role === "doctor" && actor.id === row.doctorId);
}
export function authorize(actor: Actor, row: LifecycleView, operation: Operation) {
  if (operation === "approve" || operation === "reject") {
    if (actor.role !== "doctor" || actor.id !== row.doctorId) throw new ReservationError(403, "FORBIDDEN");
  } else authorizeCreate(actor, row.patientId);
}

// BR-08
function isExpired(row: LifecycleView, time: Date) {
  if (row.status !== "PENDING_APPROVAL") return false;
  if (!row.approvalExpiresAt) throw new Error("Pending reservation has no deadline");
  return time.getTime() >= row.approvalExpiresAt.getTime();
}
export function expireIfDue(row: LifecycleView, time: Date): StateChange | null {
  return isExpired(row, time) ? EXPIRED : null;
}

export function decide(row: LifecycleView, operation: Operation, time: Date): Decision {
  if (isExpired(row, time)) return { kind: "expire", change: EXPIRED };
  if (operation === "cancel") {
    if (row.status === "CANCELLED") return { kind: "unchanged" };
    if (row.status === "REJECTED" || row.status === "EXPIRED") throw new ReservationError(409, "INVALID_STATE");
    if (row.status === "CONFIRMED" && row.startsAt.getTime() - time.getTime() < DAY_MS) {
      throw new ReservationError(409, "CANCELLATION_TOO_LATE"); // BR-03
    }
    return { kind: "change", change: { status: "CANCELLED" } };
  }
  const requiredState: ReservationStatus = operation === "confirm" ? "DRAFT" : "PENDING_APPROVAL";
  if (row.status !== requiredState) throw new ReservationError(409, "INVALID_STATE");
  if (operation === "reject") return { kind: "change", change: { status: "REJECTED" } };
  return { kind: "needsSchedule" };
}

/** Second step of confirm/approve. BR-02 collisions are decided authoritatively by the database constraint. */
export function allocate(row: LifecycleView, operation: Operation, time: Date, schedule: Schedule): StateChange {
  if (!schedule.fits) throw new ReservationError(400, "OUTSIDE_WORKING_WINDOW");
  if (operation === "confirm" && schedule.requiresApproval) {
    return { status: "PENDING_APPROVAL", approvalRequestedAt: time,
      approvalExpiresAt: new Date(Math.min(time.getTime() + DAY_MS, row.startsAt.getTime())) };
  }
  return { status: BLOCKING_STATUS };
}

/** BR-07: only an allocation requests a confirmation notification. */
export function isAllocation(change: StateChange) {
  return change.status === BLOCKING_STATUS;
}
