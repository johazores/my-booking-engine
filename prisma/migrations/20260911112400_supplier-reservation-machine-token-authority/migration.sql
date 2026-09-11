-- Supplier reservation identifiers and correlation values are commercial machine evidence.
-- They must be persisted exactly and must never contain ASCII control characters. Existing
-- rows are not rewritten: migration failure is intentional if unsafe historical evidence exists.
ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_selection_machine_reference_check"
CHECK (
  char_length("supplierPropertyReference") BETWEEN 1 AND 4096
  AND "supplierPropertyReference" = btrim("supplierPropertyReference")
  AND "supplierPropertyReference" !~ '[[:cntrl:]]'
  AND char_length("supplierOfferReference") BETWEEN 1 AND 4096
  AND "supplierOfferReference" = btrim("supplierOfferReference")
  AND "supplierOfferReference" !~ '[[:cntrl:]]'
);

ALTER TABLE "hospitality_supplier_reservation_operations"
ADD CONSTRAINT "hospitality_supplier_reservation_operations_provider_machine_reference_control_check"
CHEK (
  ("providerReservationReference" IS NULL OR "providerReservationReference" !~ '[[:cntrl:]]')
  AND ("supplierConfirmationReference" IS NULL OR "supplierConfirmationReference" !~ '[[:cntrl:]]')
  AND ("providerRecoveryReference" IS NULL OR "providerRecoveryReference" !~ '[[:cntrl:]]')
  AND ("lastProviderCorrelationId" IS NULL OR "lastProviderCorrelationId" !~ '[[:cntrl:]]')
);

ALTER TABLE "hospitality_supplier_reservation_attempts"
ADD CONSTRAINT "hospitality_supplier_reservation_attempts_provider_correlation_control_check"
CHECK (
  "providerCorrelationId" IS NULL
  OR "providerCorrelationId" !~ '[[:cntrl:]]'
);
