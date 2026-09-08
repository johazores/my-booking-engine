-- Provider-derived supplier reservation attempt states must carry durable evidence that the
-- provider boundary was crossed. Application services already enforce this invariant; these
-- checks make the ledger fail closed even for direct/internal database writes.
--
-- NOT VALID is used first so concurrent new writes are protected before legacy rows are
-- normalized. Historical provider-derived rows that predate providerRequestStartedAt are marked
-- conservatively from their existing durable lease/start timestamp. The backfilled timestamp is
-- evidence that the boundary must be treated as crossed, not a reconstruction of exact transport time.
ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempt_provider_evidence_check"
CHECK (
  "providerRequestStartedAt" IS NOT NULL
  OR NOT (
    ("kind" = 'CREATE' AND "status" IN ('SUCCEEDED', 'REVIEW_REQUIRED', 'AMBIGUOUS'))
    OR ("kind" = 'RECONCILE' AND "status" IN ('SUCCEEDED', 'NOT_FOUND'))
    OR ("kind" = 'RECOVERY_WRITE' AND "status" IN ('SUCCEEDED', 'AMBIGUOUS'))
  )
) NOT VALID;

-- REVIEW_REQUIRED is a create-only commercial no-sell outcome. A reconciliation or recovery
-- write must never be able to manufacture a price/guarantee review state through a raw write.
ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempt_review_kind_check"
CHECK ("status" <> 'REVIEW_REQUIRED' OR "kind" = 'CREATE') NOT VALID;

-- The durable review reason is intentionally limited to the three normalized commercial-change
-- codes accepted by the review workflow. Generic transport/provider failures are not review authority.
ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempt_review_failure_code_check"
CHECK (
  "status" <> 'REVIEW_REQUIRED'
  OR "normalizedFailureCode" IN (
    'SUPPLIER_PRICE_CHANGED',
    'SUPPLIER_GUARANTEE_CHANGED',
    'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'
  )
) NOT VALID;

UPDATE "hospitality_supplier_reservation_attempts"
SET
  "leaseStartedAt" = COALESCE("leaseStartedAt", "startedAt"),
  "providerRequestStartedAt" = COALESCE("providerRequestStartedAt", "leaseStartedAt", "startedAt")
WHERE "providerRequestStartedAt" IS NULL
  AND (
    ("kind" = 'CREATE' AND "status" IN ('SUCCEEDED', 'REVIEW_REQUIRED', 'AMBIGUOUS'))
    OR ("kind" = 'RECONCILE' AND "status" IN ('SUCCEEDED', 'NOT_FOUND'))
    OR ("kind" = 'RECOVERY_WRITE' AND "status" IN ('SUCCEEDED', 'AMBIGUOUS'))
  );

ALTER TABLE "hospitality_supplier_reservation_attempts"
VALIDATE CONSTRAINT "hospitality_supplier_reservation_attempt_provider_evidence_check";

ALTER TABLE "hospitality_supplier_reservation_attempts"
VALIDATE CONSTRAINT "hospitality_supplier_reservation_attempt_review_kind_check";

ALTER TABLE "hospitality_supplier_reservation_attempts"
VALIDATE CONSTRAINT "hospitality_supplier_reservation_attempt_review_failure_code_check";
