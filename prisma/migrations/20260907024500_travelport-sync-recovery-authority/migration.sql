-- Persist only bounded, non-secret provider recovery authority that was proven by a commercial
-- response. For Travelport this is the provider-owned Sync offer authority + Booking.com source;
-- it is not a booking locator, traveler detail, payment value, credential, or provider payload.
ALTER TABLE "hospitality_supplier_reservation_operations"
ADD COLUMN "providerRecoveryReference" VARCHAR(1024);

-- A supplier confirmation can be staged while the create attempt is still SUBMITTING only when
-- the same marked provider response also supplied durable recovery authority. This makes the
-- evidence crash-safe before the final AMBIGUOUS settlement without making the write retryable.
ALTER TABLE "hospitality_supplier_reservation_operations"
DROP CONSTRAINT "hospitality_supplier_reservation_operations_supplier_confirmation_reference_check";

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_supplier_confirmation_reference_check"
CHECK (
  "supplierConfirmationReference" IS NULL
  OR (
    "status" IN ('CONFIRMED', 'AMBIGUOUS', 'RECONCILING')
    AND char_length("supplierConfirmationReference") BETWEEN 1 AND 512
    AND "supplierConfirmationReference" = btrim("supplierConfirmationReference")
    AND "supplierConfirmationReference" !~ E'[\\r\\n]'
  )
  OR (
    "status" = 'SUBMITTING'
    AND "providerRecoveryReference" IS NOT NULL
    AND char_length("supplierConfirmationReference") BETWEEN 1 AND 512
    AND "supplierConfirmationReference" = btrim("supplierConfirmationReference")
    AND "supplierConfirmationReference" !~ E'[\\r\\n]'
  )
);

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_provider_recovery_reference_check"
CHECK (
  "providerRecoveryReference" IS NULL
  OR (
    "status" IN ('SUBMITTING', 'AMBIGUOUS')
    AND "supplierConfirmationReference" IS NOT NULL
    AND char_length("providerRecoveryReference") BETWEEN 1 AND 1024
    AND "providerRecoveryReference" = btrim("providerRecoveryReference")
    AND "providerRecoveryReference" !~ E'[\\r\\n]'
  )
);
