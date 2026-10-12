import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * C03 L2 — repeatable architecture conformance checks for ADR-006 and ADR-007 (docs/c03/architecture.md, G2).
 * Static: reads src/ (generated Prisma client excluded) and reports every violating file.
 */
type Source = { path: string; text: string };
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
function sources(dir = srcRoot): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sources(full);
    return entry.name.endsWith(".ts") ? [{ path: relative(srcRoot, full).split("\\").join("/"), text: readFileSync(full, "utf8") }] : [];
  });
}
function imports(file: Source) {
  return [...file.text.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map(match => ({
    typeOnly: Boolean(match[1]),
    target: match[2]!.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file.path), match[2]!)) : match[2]!,
  }));
}

/** ADR-006: only the outbox and the composition root may reach the notification provider port or its adapters. */
const gatewayModules = ["notifications/notification-service.js", "notifications/notification-stub.js"];
export function notificationGatewayViolations(files: Source[]) {
  return files.filter(file => !file.path.startsWith("notifications/") && file.path !== "server.ts")
    .filter(file => imports(file).some(i => gatewayModules.includes(i.target)) || /sendReservationConfirmation/.test(file.text))
    .map(file => file.path);
}

/** ADR-007: Reservation status values are decided only in the Lifecycle module, which performs no I/O. */
const statusLiteral = /["'](DRAFT|CONFIRMED|CANCELLED|PENDING_APPROVAL|REJECTED|EXPIRED)["']/;
export function lifecycleOwnershipViolations(files: Source[]) {
  const outside = files.filter(file => file.path !== "reservations/lifecycle.ts" && statusLiteral.test(file.text))
    .map(file => `${file.path}: status literal`);
  const lifecycle = files.find(file => file.path === "reservations/lifecycle.ts");
  const io = lifecycle ? imports(lifecycle).filter(i => !i.typeOnly && !i.target.startsWith("reservations/"))
    .map(i => `reservations/lifecycle.ts: runtime import ${i.target}`) : ["reservations/lifecycle.ts: missing"];
  return [...outside, ...io];
}

describe("C03 architecture conformance", () => {
  const files = sources();
  it("scans the real source tree", () => {
    expect(files.map(file => file.path)).toEqual(expect.arrayContaining(["app.ts", "reservations/lifecycle.ts", "notifications/outbox.ts"]));
  });
  it("ADR-006: HTTP layer and reservation logic never call the notification provider", () => {
    expect(notificationGatewayViolations(files)).toEqual([]);
  });
  it("ADR-007: only reservations/lifecycle.ts decides Reservation status, without I/O", () => {
    expect(lifecycleOwnershipViolations(files)).toEqual([]);
  });
  it("the checks detect violations (guards against a vacuous rule)", () => {
    const bad: Source[] = [
      { path: "app.ts", text: 'import type { NotificationService } from "./notifications/notification-service.js";\nnotifications.sendReservationConfirmation(m);' },
      { path: "reservations/reservation-service.ts", text: 'await tx.reservation.update({ data: { status: "CONFIRMED" } });' },
      { path: "reservations/lifecycle.ts", text: 'import { PrismaClient } from "../generated/prisma/client.js";' },
    ];
    expect(notificationGatewayViolations(bad)).toEqual(["app.ts"]);
    expect(lifecycleOwnershipViolations(bad)).toEqual([
      "reservations/reservation-service.ts: status literal", "reservations/lifecycle.ts: runtime import generated/prisma/client.js"]);
  });
});
