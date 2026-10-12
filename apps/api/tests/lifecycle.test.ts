import { describe, expect, it } from "vitest";
import { allocate, authorize, decide, expireIfDue, type LifecycleView } from "../src/reservations/lifecycle.js";

/** ADR-007: statechart v0.2 decisions are testable without a database. */
const patient = { role: "patient" as const, id: "p" }, doctor = { role: "doctor" as const, id: "d" };
const startsAt = new Date("2030-02-04T08:00:00Z");
const row = (status: LifecycleView["status"], approvalExpiresAt: Date | null = null): LifecycleView =>
  ({ status, patientId: "p", doctorId: "d", startsAt, approvalExpiresAt });
const time = new Date("2030-01-01T00:00:00Z");
const schedule = { fits: true, requiresApproval: true };

describe("Reservation Lifecycle (pure)", () => {
  it("confirm of DRAFT needs the schedule; approval doctors move to PENDING_APPROVAL with a capped deadline", () => {
    expect(decide(row("DRAFT"), "confirm", time)).toEqual({ kind: "needsSchedule" });
    expect(allocate(row("DRAFT"), "confirm", time, schedule)).toEqual({ status: "PENDING_APPROVAL",
      approvalRequestedAt: time, approvalExpiresAt: new Date("2030-01-02T00:00:00Z") });
    const late = new Date("2030-02-04T07:00:00Z");
    expect(allocate(row("DRAFT"), "confirm", late, schedule).approvalExpiresAt).toEqual(startsAt);
  });
  it("approve allocates regardless of the current flag; outside window is rejected", () => {
    expect(allocate(row("PENDING_APPROVAL"), "approve", time, schedule)).toEqual({ status: "CONFIRMED" });
    expect(() => allocate(row("DRAFT"), "confirm", time, { fits: false, requiresApproval: false })).toThrow("OUTSIDE_WORKING_WINDOW");
  });
  it("BR-08: expiry wins exactly at the deadline", () => {
    const deadline = new Date("2030-01-02T00:00:00Z");
    expect(expireIfDue(row("PENDING_APPROVAL", deadline), new Date(deadline.getTime() - 1))).toBeNull();
    expect(decide(row("PENDING_APPROVAL", deadline), "approve", deadline)).toEqual({ kind: "expire", change: { status: "EXPIRED" } });
  });
  it("BR-03: CONFIRMED cancel at exactly 24h is allowed, 1 ms later rejected; repeated cancel is unchanged", () => {
    expect(decide(row("CONFIRMED"), "cancel", new Date("2030-02-03T08:00:00Z"))).toEqual({ kind: "change", change: { status: "CANCELLED" } });
    expect(() => decide(row("CONFIRMED"), "cancel", new Date("2030-02-03T08:00:00.001Z"))).toThrow("CANCELLATION_TOO_LATE");
    expect(decide(row("CANCELLED"), "cancel", time)).toEqual({ kind: "unchanged" });
  });
  it("BR-05: only the owning doctor decides, only the owning patient confirms/cancels", () => {
    expect(() => authorize(patient, row("PENDING_APPROVAL"), "approve")).toThrow("FORBIDDEN");
    expect(() => authorize({ role: "doctor", id: "x" }, row("PENDING_APPROVAL"), "reject")).toThrow("FORBIDDEN");
    expect(() => authorize(doctor, row("DRAFT"), "confirm")).toThrow("FORBIDDEN");
    expect(() => authorize(doctor, row("PENDING_APPROVAL"), "approve")).not.toThrow();
  });
  it("invalid source states are rejected", () => {
    expect(() => decide(row("CONFIRMED"), "confirm", time)).toThrow("INVALID_STATE");
    expect(() => decide(row("DRAFT"), "approve", time)).toThrow("INVALID_STATE");
    expect(() => decide(row("REJECTED"), "cancel", time)).toThrow("INVALID_STATE");
  });
});
