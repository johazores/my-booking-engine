-- Existing supplier reservation operations predate selected-offer reservation authority
-- in the exact request fingerprint. Preserve those rows for reconciliation, but distinguish
-- them from new authority-bound requests without guessing or backfilling commercial evidence.
ALTER TABLE "hospitality_supplier_reservation_operations"
  ADD COLUMN "requestFingerprintVersion" INTEGER;

-- New inserts use request fingerprint v2. Existing rows remain NULL because the default is set
-- only after the column exists, so legacy PREPARED/retryable FAILED operations fail closed.
ALTER TABLE "hospitality_supplier_reservation_operations"
  ALTER COLUMN "requestFingerprintVersion" SET DEFAULT 2;

ALTER TABLE "hospitality_supplier_reservation_operations"
  ADD CONSTRAINT "hospitality_supplier_reservation_operations_request_fingerprint_version_check"
  CHECK (
    "requestFingerprintVersion" IS NULL
    OR "requestFingerprintVersion" = 2
  );
