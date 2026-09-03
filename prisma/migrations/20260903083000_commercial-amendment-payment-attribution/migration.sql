ALTER TABLE "payment_transactions"
  ADD COLUMN "commercialAmendmentId" UUID;

CREATE UNIQUE INDEX "hospitality_booking_commercial_amendments_id_booking_org_key"
  ON "hospitality_booking_commercial_amendments"("id", "bookingId", "organizationId");

CREATE INDEX "payment_transactions_org_commercial_amendment_created_idx"
  ON "payment_transactions"("organizationId", "commercialAmendmentId", "createdAt");

ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_commercial_amendment_fkey"
  FOREIGN KEY ("commercialAmendmentId", "bookingId", "organizationId")
  REFERENCES "hospitality_booking_commercial_amendments"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
