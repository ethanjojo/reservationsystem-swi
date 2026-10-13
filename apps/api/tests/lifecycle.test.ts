import { describe, expect, it } from "vitest";
import { reservationLifecycle, expireIfDue, type LifecycleView, type Operation, type TransitionCommand } from "../src/reservations/lifecycle.js";

// C05: expected outcomes come from the DD table, not from implementation branches.
const patient = { role: "patient" as const, id: "p" }, doctor = { role: "doctor" as const, id: "d" };
const time = new Date("2030-01-01T00:00:00Z");
const startsAt = new Date("2030-02-04T08:00:00Z");
const deadline = new Date("2030-01-02T00:00:00Z");
const row = (status: LifecycleView["status"] = "DRAFT"): LifecycleView => ({
  status, patientId: "p", doctorId: "d", startsAt, approvalExpiresAt: status === "PENDING_APPROVAL" ? deadline : null,
});
const actorFor = (operation: Operation) => operation === "approve" || operation === "reject" ? doctor : patient;
const command = (operation: Operation, overrides: Partial<TransitionCommand> = {}): TransitionCommand => ({
  row: row(operation === "approve" || operation === "reject" ? "PENDING_APPROVAL" : "DRAFT"),
  actor: actorFor(operation), operation, time, ...overrides,
});
const evaluate = (operation: Operation, overrides: Partial<TransitionCommand> = {}) => reservationLifecycle.evaluate(command(operation, overrides));
const fits = { fits: true, requiresApproval: false };
function rejects(action: () => unknown, status: number, code: string) {
  try { action(); } catch (error) { expect(error).toMatchObject({ status, code }); return; }
  throw new Error(`Expected rejection ${code}`);
}

describe("C05 LifecyclePolicy contract", () => {
  it.each(["confirm", "cancel", "approve", "reject"] as const)("C05-01: %s cannot bypass ownership with schedule", operation => {
    const owner = actorFor(operation);
    rejects(() => evaluate(operation, { actor: { ...owner, id: "other" }, schedule: fits }), 403, "FORBIDDEN");
    rejects(() => evaluate(operation, { actor: operation === "approve" || operation === "reject" ? patient : doctor, schedule: fits }), 403, "FORBIDDEN");
  });
  it.each([
    ["approve", "DRAFT"], ["approve", "CONFIRMED"], ["approve", "CANCELLED"],
    ["confirm", "REJECTED"], ["confirm", "EXPIRED"], ["confirm", "CONFIRMED"],
  ] as const)("C05-02: supplied schedule cannot allocate %s from %s", (operation, status) => {
    rejects(() => evaluate(operation, { row: row(status), schedule: fits }), 409, "INVALID_STATE");
  });
  it("C05-03: authorization takes precedence over expiry and missing internal deadline", () => {
    rejects(() => evaluate("approve", { actor: patient, time: deadline, schedule: fits }), 403, "FORBIDDEN");
    rejects(() => evaluate("approve", { actor: patient, row: { ...row("PENDING_APPROVAL"), approvalExpiresAt: null } }), 403, "FORBIDDEN");
  });

  const table = [
    ["DRAFT", "needsSchedule", "CANCELLED", "invalid", "invalid"],
    ["CONFIRMED", "invalid", "CANCELLED", "invalid", "invalid"],
    ["PENDING_APPROVAL", "invalid", "CANCELLED", "needsSchedule", "REJECTED"],
    ["CANCELLED", "invalid", "unchanged", "invalid", "invalid"],
    ["REJECTED", "invalid", "invalid", "invalid", "invalid"],
    ["EXPIRED", "invalid", "invalid", "invalid", "invalid"],
  ] as const;
  const operations = ["confirm", "cancel", "approve", "reject"] as const;
  const cases = table.flatMap(([status, ...outcomes]) => operations.map((operation, i) => ({ status, operation, expected: outcomes[i]! })));
  it.each(cases)("C05-04: $status + $operation => $expected", ({ status, operation, expected }) => {
    const invoke = () => evaluate(operation, { row: row(status) });
    if (expected === "invalid") rejects(invoke, 409, "INVALID_STATE");
    else if (expected === "needsSchedule" || expected === "unchanged") expect(invoke()).toEqual({ kind: expected });
    else expect(invoke()).toEqual({ kind: "change", change: { status: expected } });
  });
  it("C05-05: confirmed cancellation accepts exactly 24h and rejects one millisecond less", () => {
    const boundary = new Date(startsAt.getTime() - 86_400_000);
    expect(evaluate("cancel", { row: row("CONFIRMED"), time: boundary })).toEqual({ kind: "change", change: { status: "CANCELLED" } });
    rejects(() => evaluate("cancel", { row: row("CONFIRMED"), time: new Date(boundary.getTime() + 1) }), 409, "CANCELLATION_TOO_LATE");
  });
  it.each(operations)("C05-06: expiry takes precedence over %s exactly at deadline", operation => {
    expect(evaluate(operation, { row: row("PENDING_APPROVAL"), time: deadline, schedule: fits }))
      .toEqual({ kind: "expire", change: { status: "EXPIRED" } });
  });
  it("C05-06: one millisecond before expiry permits approval; read policy agrees", () => {
    const before = new Date(deadline.getTime() - 1);
    expect(evaluate("approve", { time: before, schedule: fits })).toEqual({ kind: "change", change: { status: "CONFIRMED" } });
    expect(expireIfDue(row("PENDING_APPROVAL"), before)).toBeNull();
    expect(expireIfDue(row("PENDING_APPROVAL"), deadline)).toEqual({ status: "EXPIRED" });
  });
  it.each([0, -1])("C05-07: draft starting at now %+d ms cannot be confirmed even with fits=true", offset => {
    rejects(() => evaluate("confirm", { row: { ...row(), startsAt: new Date(time.getTime() + offset) }, schedule: fits }), 400, "START_MUST_BE_FUTURE");
  });
  it("C05-08: only missing schedule needs data; a supplied invalid window is rejected", () => {
    expect(evaluate("confirm")).toEqual({ kind: "needsSchedule" });
    expect(evaluate("approve")).toEqual({ kind: "needsSchedule" });
    for (const operation of ["confirm", "approve"] as const) {
      rejects(() => evaluate(operation, { schedule: { fits: false, requiresApproval: true } }), 400, "OUTSIDE_WORKING_WINDOW");
      expect(evaluate(operation, { schedule: fits })).toEqual({ kind: "change", change: { status: "CONFIRMED" } });
    }
  });
  it("C05-09: approval request persists a 24h deadline capped by appointment start", () => {
    expect(evaluate("confirm", { schedule: { ...fits, requiresApproval: true } })).toEqual({ kind: "change", change: {
      status: "PENDING_APPROVAL", approvalRequestedAt: time, approvalExpiresAt: deadline,
    } });
    const soon = new Date(time.getTime() + 3_600_000);
    expect(evaluate("confirm", { row: { ...row(), startsAt: soon }, schedule: { ...fits, requiresApproval: true } }))
      .toEqual({ kind: "change", change: { status: "PENDING_APPROVAL", approvalRequestedAt: time, approvalExpiresAt: soon } });
    expect(evaluate("approve", { schedule: { ...fits, requiresApproval: true } })).toEqual({ kind: "change", change: { status: "CONFIRMED" } });
  });
  it("C05-10: inputs remain unchanged and output metadata is not shared with inputs or another decision", () => {
    const input = Object.freeze(command("confirm", { row: Object.freeze(row()), actor: Object.freeze({ ...patient }),
      schedule: Object.freeze({ ...fits, requiresApproval: true }), time: new Date(time) }));
    const before = structuredClone(input);
    const first = reservationLifecycle.evaluate(input), second = reservationLifecycle.evaluate(input);
    expect(input).toEqual(before); expect(first).toEqual(second);
    expect(first.kind).toBe("change"); expect(second.kind).toBe("change");
    if (first.kind !== "change" || second.kind !== "change") throw new Error("Expected changes");
    first.change.approvalRequestedAt!.setTime(0); first.change.approvalExpiresAt!.setTime(0);
    expect(input).toEqual(before);
    expect(second.change.approvalRequestedAt).toEqual(time); expect(second.change.approvalExpiresAt).toEqual(deadline);
    expect(expireIfDue(row("PENDING_APPROVAL"), deadline)).not.toBe(expireIfDue(row("PENDING_APPROVAL"), deadline));
  });
  it("C05-11: missing pending deadline is an internal contract violation", () => {
    expect(() => evaluate("approve", { row: { ...row("PENDING_APPROVAL"), approvalExpiresAt: null }, schedule: fits }))
      .toThrow("Pending reservation has no deadline");
  });
  it("C05-05: draft cancellation stays possible after start; pending cancellation before deadline is unrestricted", () => {
    expect(evaluate("cancel", { time: new Date("2031-01-01T00:00:00Z") })).toEqual({ kind: "change", change: { status: "CANCELLED" } });
    expect(evaluate("cancel", { row: row("PENDING_APPROVAL"), time: new Date(deadline.getTime() - 1) })).toEqual({ kind: "change", change: { status: "CANCELLED" } });
  });
});
