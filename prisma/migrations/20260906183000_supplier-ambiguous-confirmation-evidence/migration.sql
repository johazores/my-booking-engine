-- A confirmed supplier sell can exist before Travelport finishes PNR processing.
-- Preserve the bounded supplier confirmation as recovery evidence while the SF operation
-- remains ambiguous/reconciling. This does not make the operation confirmed or retryable.
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
);
