-- Additive change: existing doctors remain automatic, reservations are retained.
ALTER TYPE "ReservationStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ReservationStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ReservationStatus" ADD VALUE 'EXPIRED';
ALTER TABLE "Doctor" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reservation"
  ADD COLUMN "approvalRequestedAt" TIMESTAMPTZ(3),
  ADD COLUMN "approvalExpiresAt" TIMESTAMPTZ(3);
-- The existing exclusion constraint still applies only to CONFIRMED.
