-- Distinguish a claimed supplier attempt from one that may actually have crossed the provider boundary.
-- Existing STARTED attempts predate this evidence, so migrate them conservatively as provider-started and
-- grant a fresh database-authored lease instead of making an uncertain external write look retry-safe.
ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD COLUMN "providerRequestStartedAt" TIMESTAMPTZ(6);

WITH "providerRequestMigrationClock" AS (
  SELECT clock_timestamp() AS "currentTime"
)
UPDATE "hospitality_supplier_reservation_attempts" AS "attempt"
SET
  "providerRequestStartedAt" = "clock"."currentTime",
  "leaseStartedAt" = "clock"."currentTime"
FROM "providerRequestMigrationClock" AS "clock"
WHERE "attempt"."status" = 'STARTED';

ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempt_provider_request_clock_check"
CHECK (
  "providerRequestStartedAt" IS NULL
  OR (
    "leaseStartedAt" IS NOT NULL
    AND "providerRequestStartedAt" >= "leaseStartedAt"
  )
);
