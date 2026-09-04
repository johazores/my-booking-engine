ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD COLUMN "commercialAmendmentId" UUID,
  ADD COLUMN "targetPricingEvidenceId" UUID,
  ADD COLUMN "sourceAdjustmentOrdinal" INTEGER NOT NULL DEFAULT 1,
  ALTER COLUMN "refundTransactionId" DROP NOT NULL;

ALTER TABLE "hospitality_issued_adjustment_notes"
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_contract_check",
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_snapshot_check",
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_source_invoice_fkey",
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_refund_transaction_fkey";

CREATE UNIQUE INDEX "hospitality_issued_invoices_id_booking_org_key"
  ON "hospitality_issued_invoices"("id", "bookingId", "organizationId");

CREATE UNIQUE INDEX "payment_transactions_id_booking_org_key"
  ON "payment_transactions"("id", "bookingId", "organizationId");

CREATE UNIQUE INDEX "hospitality_adj_notes_org_commercial_amendment_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "commercialAmendmentId");

CREATE UNIQUE INDEX "hospitality_adj_notes_org_target_pricing_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "targetPricingEvidenceId");

CREATE UNIQUE INDEX "hospitality_adj_notes_org_source_ordinal_key"
  ON "hospitality_issued_adjustment_notes"("organizationId", "sourceInvoiceId", "sourceAdjustmentOrdinal");

CREATE INDEX "hospitality_adj_notes_org_commercial_issued_idx"
  ON "hospitality_issued_adjustment_notes"("organizationId", "commercialAmendmentId", "issuedAt");

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_contract_check" CHECK (
    "jurisdictionCode" = 'AU'
    AND "documentType" = 'ADJUSTMENT_NOTE'
    AND "documentNumber" ~ '^AU-ADJ-[0-9]{8,}$'
    AND "sequenceValue" >= 1
    AND "currency" = 'AUD'
    AND "adjustmentReason" IN ('BOOKING_CANCELLATION', 'COMMERCIAL_AMENDMENT')
  ),
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_authority_check" CHECK (
    "sourceAdjustmentOrdinal" = 1
    AND (
      (
        "adjustmentReason" = 'BOOKING_CANCELLATION'
        AND "refundTransactionId" IS NOT NULL
        AND "commercialAmendmentId" IS NULL
        AND "targetPricingEvidenceId" IS NULL
      )
      OR
      (
        "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "refundTransactionId" IS NULL
        AND "commercialAmendmentId" IS NOT NULL
        AND "targetPricingEvidenceId" IS NOT NULL
      )
    )
  ),
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_snapshot_check" CHECK (
    jsonb_typeof("documentSnapshot") = 'object'
    AND "documentSnapshot"->>'kind' = 'ADJUSTMENT_NOTE'
    AND "documentSnapshot"->>'jurisdictionCode' = "jurisdictionCode"
    AND "documentSnapshot"->>'adjustmentType' = 'DECREASING'
    AND "documentSnapshot"->>'adjustmentReason' = "adjustmentReason"
    AND "documentSnapshot"->>'organizationId' = "organizationId"::text
    AND "documentSnapshot"->>'bookingId' = "bookingId"::text
    AND "documentSnapshot"->>'sourceInvoiceId' = "sourceInvoiceId"::text
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
    AND (
      (
        "adjustmentReason" = 'BOOKING_CANCELLATION'
        AND "documentSnapshot"->>'schemaVersion' = '1'
        AND "documentSnapshot"->>'refundTransactionId' = "refundTransactionId"::text
        AND NOT ("documentSnapshot" ? 'commercialAmendmentId')
        AND NOT ("documentSnapshot" ? 'targetPricingEvidenceId')
        AND NOT ("documentSnapshot" ? 'sourceAdjustmentOrdinal')
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Booking cancellation'
      )
      OR
      (
        "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "documentSnapshot"->>'schemaVersion' = '2'
        AND NOT ("documentSnapshot" ? 'refundTransactionId')
        AND "documentSnapshot"->>'commercialAmendmentId' = "commercialAmendmentId"::text
        AND "documentSnapshot"->>'targetPricingEvidenceId' = "targetPricingEvidenceId"::text
        AND "documentSnapshot"->>'sourceAdjustmentOrdinal' = "sourceAdjustmentOrdinal"::text
        AND "documentSnapshot"->>'beforePricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'afterPricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND ("documentSnapshot"->>'beforeTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'beforeTaxMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTaxMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'beforeTotalMinor')::bigint > ("documentSnapshot"->>'afterTotalMinor')::bigint
        AND ("documentSnapshot"->>'beforeTotalMinor')::bigint - ("documentSnapshot"->>'afterTotalMinor')::bigint = "decreaseTotalMinor"
        AND ("documentSnapshot"->>'beforeTaxMinor')::bigint - ("documentSnapshot"->>'afterTaxMinor')::bigint = "decreaseTaxMinor"
        AND ("documentSnapshot"->>'beforeTaxMinor')::bigint * 11 = ("documentSnapshot"->>'beforeTotalMinor')::bigint
        AND ("documentSnapshot"->>'afterTaxMinor')::bigint * 11 = ("documentSnapshot"->>'afterTotalMinor')::bigint
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Commercial booking amendment'
      )
    )
  );

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_source_invoice_booking_fkey"
  FOREIGN KEY ("sourceInvoiceId", "bookingId", "organizationId")
  REFERENCES "hospitality_issued_invoices"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_refund_booking_fkey"
  FOREIGN KEY ("refundTransactionId", "bookingId", "organizationId")
  REFERENCES "payment_transactions"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_commercial_amendment_fkey"
  FOREIGN KEY ("commercialAmendmentId", "bookingId", "organizationId")
  REFERENCES "hospitality_booking_commercial_amendments"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_target_pricing_fkey"
  FOREIGN KEY ("targetPricingEvidenceId", "bookingId", "organizationId")
  REFERENCES "hospitality_booking_pricing_evidence"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
