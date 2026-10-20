import type { Reservation, ReservationStatus } from "../generated/prisma/client.js";
import type { Actor } from "../actors.js";
import { ReservationError } from "./errors.js";

/**
 * Reservation Lifecycle (ADR-007): the single owner of statechart v0.2 and BR-03/05/08.
 * Pure — no I/O. Reservation Service locks and loads, asks for a decision and applies the returned StateChange.
 */
export type Operation = "confirm" | "cancel" | "approve" | "reject";
export type LifecycleView = Readonly<Pick<Reservation, "status" | "patientId" | "doctorId" | "startsAt" | "approvalExpiresAt">>;
export type StateChange = { status: ReservationStatus; approvalRequestedAt?: Date; approvalExpiresAt?: Date };
export type Decision =
  | { kind: "expire"; change: StateChange } // BR-08: committed even though the caller receives 409
  | { kind: "unchanged" }
  | { kind: "change"; change: StateChange }
  | { kind: "needsSchedule" }; // confirm/approve depend on current working windows (BR-04)
export type Schedule = Readonly<{ fits: boolean; requiresApproval: boolean }>;
/** C05: schedule is a fact input, never authorization to skip the guards. */
export interface TransitionCommand {
  readonly row: LifecycleView;
  readonly actor: Actor;
  readonly operation: Operation;
  readonly time: Date;
  readonly schedule?: Schedule;
}
export interface LifecyclePolicy {
  evaluate(command: TransitionCommand): Decision;
}

const DAY_MS = 86_400_000;
export const INITIAL_STATE: StateChange = { status: "DRAFT" };
/** BR-02: the only state that allocates the Resource. */
export const BLOCKING_STATUS: ReservationStatus = "CONFIRMED";

// BR-05
export function authorizeCreate(actor: Actor, patientId: string) {
  if (actor.role !== "patient" || actor.id !== patientId) throw new ReservationError(403, "FORBIDDEN");
}
export function canRead(actor: Actor, row: LifecycleView) {
  return (actor.role === "patient" && actor.id === row.patientId) || (actor.role === "doctor" && actor.id === row.doctorId);
}
function authorize(actor: Actor, row: LifecycleView, operation: Operation) {
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
  return isExpired(row, time) ? { status: "EXPIRED" } : null;
}

/** Pure C05 evaluator: every entry, including a second pass, enforces the entire command contract. */
function evaluate({ row, actor, operation, time, schedule }: TransitionCommand): Decision {
  authorize(actor, row, operation);
  const expiry = expireIfDue(row, time);
  if (expiry) return { kind: "expire", change: expiry };
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
  if (row.startsAt.getTime() <= time.getTime()) throw new ReservationError(400, "START_MUST_BE_FUTURE");
  if (!schedule) return { kind: "needsSchedule" };
  if (!schedule.fits) throw new ReservationError(400, "OUTSIDE_WORKING_WINDOW");
  if (operation === "confirm" && schedule.requiresApproval) {
    return { kind: "change", change: { status: "PENDING_APPROVAL", approvalRequestedAt: new Date(time.getTime()),
      approvalExpiresAt: new Date(Math.min(time.getTime() + DAY_MS, row.startsAt.getTime())) } };
  }
  return { kind: "change", change: { status: BLOCKING_STATUS } };
}

export const reservationLifecycle: LifecyclePolicy = { evaluate };

/** BR-07: only an allocation requests a confirmation notification. */
export function isAllocation(change: StateChange) {
  return change.status === BLOCKING_STATUS;
}
