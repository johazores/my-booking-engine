-- Lease recovery must use a database-authored clock on both sides of the comparison.
-- Existing STARTED attempts receive a fresh conservative lease at deployment time so migration
-- cannot immediately declare an in-flight provider operation stale from an application-node timestamp.
ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD COLUMN "leaseStartedAt" TIMESTAMPTZ(6);

UPDATE "hospitality_supplier_reservation_attempts"
SET "leaseStartedAt" = clock_timestamp()
WHERE "status" = 'STARTED';

ALTER TABLE "hospitality_supplier_reservation_attempts"
ALTER COLUMN "leaseStartedAt" SET DEFAULT clock_timestamp();

ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempt_started_lease_check"
CHECK ("status" <> 'STARTED' OR "leaseStartedAt" IS NOT NULL);
