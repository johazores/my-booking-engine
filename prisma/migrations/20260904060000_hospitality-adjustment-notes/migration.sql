CREATE TABLE "hospitality_issued_adjustment_notes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "sourceInvoiceId" UUID NOT NULL,
    "refundTransactionId" UUID NOT NULL,
    "jurisdictionCode" VARCHAR(16) NOT NULL,
    "documentType" VARCHAR(32) NOT NULL,
    "documentNumber" VARCHAR(64) NOT NULL,
    "sequenceValue" BIGINT NOT NULL,
    "issuedByUserId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "adjustmentReason" VARCHAR(32) NOT NULL,
    "decreaseSubtotalMinor" BIGINT NOT NULL,
    "decreaseTaxMinor" BIGINT NOT NULL,
    "decreaseTotalMinor" BIGINT NOT NULL,
    "sourceInvoiceFingerprint" CHAR(64) NOT NULL,
    "issuerFingerprint" CHAR(64) NOT NULL,
    "recipientFingerprint" CHAR(64) NOT NULL,
    "documentFingerprint" CHAR(64) NOT NULL,
    "documentSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_issued_adjustment_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_issued_adjustment_notes_contract_check" CHECK (
      "jurisdictionCode" = 'AU'
      AND "documentType" = 'ADJUSTMENT_NOTE'
      AND "documentNumber" ~ '^AU-ADJ-[0-9]{8,}$'
      AND "sequenceValue" >= 1
      AND "currency" = 'AUD'
      AND "adjustmentReason" = 'BOOKING_CANCELLATION'
    ),
    CONSTRAINT "hospitality_issued_adjustment_notes_money_check" CHECK (
      "decreaseSubtotalMinor" > 0
      AND "decreaseTaxMinor" > 0
      AND "decreaseTotalMinor" = "decreaseSubtotalMinor" + "decreaseTaxMinor"
      AND "decreaseTaxMinor" * 11 = "decreaseTotalMinor"
    ),
    CONSTRAINT "hospitality_issued_adjustment_notes_fingerprint_check" CHECK (
      "sourceInvoiceFingerprint" ~ '^[a-f0-9]{64}$'
      AND "issuerFingerprint" ~ '^[a-f0-9]{64}$'
      AND "recipientFingerprint" ~ '^[a-f0-9]{64}$'
      AND "documentFingerprint" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "hospitality_issued_adjustment_notes_snapshot_check" CHECK (
      jsonb_typeof("documentSnapshot") = 'object'
      AND "documentSnapshot"->>'schemaVersion' = '1'
      AND "documentSnapshot"->>'kind' = 'ADJUSTMENT_NOTE'
      AND "documentSnapshot"->>'jurisdictionCode' = "jurisdictionCode"
      AND "documentSnapshot"->>'adjustmentType' = 'DECREASING'
      AND "documentSnapshot"->>'adjustmentReason' = "adjustmentReason"
      AND "documentSnapshot"->>'organizationId' = "organizationId"::text
      AND "documentSnapshot"->>'bookingId' = "bookingId"::text
      AND "documentSnapshot"->>'sourceInvoiceId' = "sourceInvoiceId"::text
      AND "documentSnapshot"->>'refundTransactionId' = "refundTransactionId"::text
      AND "documentSnapshot"->>'documentNumber' = "documentNumber"
      AND "documentSnapshot"->>'sequenceValue' = "sequenceValue"::text
      AND "documentSnapshot"->>'currency' = "currency"
      AND "documentSnapshot"->>'decreaseSubtotalMinor' = "decreaseSubtotalMinor"::text
      AND "documentSnapshot"->>'decreaseTaxMinor' = "decreaseTaxMinor"::text
      AND "documentSnapshot"->>'decreaseTotalMinor' = "decreaseTotalMinor"::text
      AND "documentSnapshot"->>'sourceInvoiceFingerprint' = "sourceInvoiceFingerprint"
      AND "documentSnapshot"->>'issuerFingerprint' = "issuerFingerprint"
      AND "documentSnapshot"->>'recipientFingerprint' = "recipientFingerprint"
      AND jsonb_typeof("documentSnapshot"->'issuer') = 'object'
      AND jsonb_typeof("documentSnapshot"->'recipient') = 'object'
      AND jsonb_typeof("documentSnapshot"->'australianTax') = 'object'
      AND "documentSnapshot"->'australianTax'->>'documentLabel' = 'Adjustment note'
      AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Booking cancellation'
    )
);

CREATE UNIQUE INDEX "hospitality_issued_adjustment_notes_id_org_key"
  ON "hospitality_issued_adjustment_notes"("id", "organizationId");
CREATE UNIQUE INDEX "hospitality_issued_adjustment_notes_org_refund_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "refundTransactionId");
CREATE UNIQUE INDEX "hospitality_issued_adjustment_notes_org_jurisdiction_number_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "jurisdictionCode", "documentNumber");
CREATE UNIQUE INDEX "hospitality_issued_adjustment_notes_org_jurisdiction_type_sequence_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "jurisdictionCode", "documentType", "sequenceValue");
CREATE UNIQUE INDEX "hospitality_issued_adjustment_notes_org_fingerprint_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "documentFingerprint");
CREATE INDEX "hospitality_issued_adjustment_notes_org_booking_issued_idx"
  ON "hospitality_issued_adjustment_notes"("organizationId", "bookingId", "issuedAt");
CREATE INDEX "hospitality_issued_adjustment_notes_org_source_issued_idx"
  ON "hospitality_issued_adjustment_notes"("organizationId", "sourceInvoiceId", "issuedAt");

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_source_invoice_fkey"
  FOREIGN KEY ("sourceInvoiceId", "organizationId") REFERENCES "hospitality_issued_invoices"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_refund_transaction_fkey"
  FOREIGN KEY ("refundTransactionId", "organizationId") REFERENCES "payment_transactions"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_issued_by_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
