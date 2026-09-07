-- REVIEW_REQUIRED is definitive no-sell evidence that must remain blocked until a separate,
-- explicitly authorized price/guarantee acceptance workflow is implemented. It cannot carry a
-- provider locator and it must retain a normalized review reason while retryability stays NULL.
ALTER TABLE "hospitality_supplier_reservation_operations"
DROP CONSTRAINT "hospitality_supplier_reservation_operations_provider_reference_state_check";

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_provider_reference_state_check"
CHECK (
  (
    "status" = 'CONFIRMED'
    AND "providerReservationReference" IS NOT NULL
    AND length(btrim("providerReservationReference")) >= 1
  )
  OR "status" IN ('AMBIGUOUS', 'RECONCILING')
  OR (
    "status" IN ('PREPARED', 'SUBMITTING', 'REVIEW_REQUIRED', 'FAILED')
    AND "providerReservationReference" IS NULL
  )
);

ALTER TABLE "hospitality_supplier_reservation_operations"
DROP CONSTRAINT "hospitality_supplier_reservation_operations_failed_contract_check";

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_failure_state_contract_check"
CHECK (
  (
    "status" = 'FAILED'
    AND "lastFailureCode" IS NOT NULL
    AND "lastFailureRetryable" IS NOT NULL
  )
  OR (
    "status" = 'REVIEW_REQUIRED'
    AND "lastFailureCode" IN (
      'SUPPLIER_PRICE_CHANGED',
      'SUPPLIER_GUARANTEE_CHANGED',
      'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED'
    )
    AND "lastFailureRetryable" IS NULL
  )
  OR "status" NOT IN ('FAILED', 'REVIEW_REQUIRED')
);

ALTER TABLE "hospitality_supplier_reservation_attempts"
DROP CONSTRAINT "hospitality_supplier_reservation_attempts_failure_code_check";

ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempts_failure_code_check"
CHECK (
  (
    "normalizedFailureCode" IS NULL
    OR "normalizedFailureCode" ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
  )
  AND (
    "status" NOT IN ('FAILED', 'REVIEW_REQUIRED')
    OR "normalizedFailureCode" IS NOT NULL
  )
);
