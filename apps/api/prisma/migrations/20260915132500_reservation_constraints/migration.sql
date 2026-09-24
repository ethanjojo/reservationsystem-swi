-- Prisma cannot express PostgreSQL exclusion/check constraints in schema.prisma.
-- Keep this SQL migration as the source of truth; do not replace it with db push.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "WorkingWindow" ADD CONSTRAINT "working_window_bounds"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0
    AND "endMinute" <= 1440 AND "startMinute" < "endMinute");
ALTER TABLE "Service" ADD CONSTRAINT "service_duration_bounds"
  CHECK ("durationMinutes" BETWEEN 1 AND 1440);
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_positive_interval"
  CHECK ("startsAt" < "endsAt");
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_no_overlap"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" = 'CONFIRMED');
