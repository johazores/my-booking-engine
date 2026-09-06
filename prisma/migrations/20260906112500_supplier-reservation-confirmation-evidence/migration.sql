-- Preserve provider/supplier confirmation evidence required for deterministic recovery and
-- future reservation lifecycle operations. This does not enable supplier create/cancel capability.
ALTER TABLE "hospitality_supplier_reservation_operations"
ADD COLUMN "supplierConfirmationReference" VARCHAR(512);

-- A known provider locator may exist before final confirmation when a create outcome is ambiguous.
-- Existing PREPARED/SUBMITTING/FAILED states must not carry provider-confirmation evidence.
ALTER TABLE "hospitality_supplier_reservation_operations"
DROP CONSTRAINT "hospitality_supplier_reservation_operations_confirmed_reference_check";

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
    "status" IN ('PREPARED', 'SUBMITTING', 'FAILED')
    AND "providerReservationReference" IS NULL
  )
);

ALTER TABLE "hospitality_supplier_reservation_operations"
DROP CONSTRAINT "hospitality_supplier_reservation_operations_provider_reference_check";

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_provider_reference_format_check"
CHECK (
  "providerReservationReference" IS NULL
  OR (
    char_length("providerReservationReference") BETWEEN 1 AND 512
    AND "providerReservationReference" = btrim("providerReservationReference")
    AND "providerReservationReference" !~ E'[\\r\\n]'
  )
);

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_supplier_confirmation_reference_check"
CHECK (
  "supplierConfirmationReference" IS NULL
  OR (
    "status" = 'CONFIRMED'
    AND char_length("supplierConfirmationReference") BETWEEN 1 AND 512
    AND "supplierConfirmationReference" = btrim("supplierConfirmationReference")
    AND "supplierConfirmationReference" !~ E'[\\r\\n]'
  )
);
