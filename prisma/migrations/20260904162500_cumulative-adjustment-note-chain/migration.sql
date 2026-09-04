ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD COLUMN "predecessorAdjustmentNoteId" UUID,
  ADD COLUMN "predecessorSourceAdjustmentOrdinal" INTEGER;

CREATE UNIQUE INDEX "hospitality_adj_notes_predecessor_key"
  ON "hospitality_issued_adjustment_notes"("predecessorAdjustmentNoteId");

CREATE UNIQUE INDEX "hospitality_adj_notes_chain_reference_key"
  ON "hospitality_issued_adjustment_notes"(
    "id",
    "bookingId",
    "organizationId",
    "sourceInvoiceId",
    "sourceAdjustmentOrdinal",
    "adjustmentReason"
  );

ALTER TABLE "hospitality_issued_adjustment_notes"
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_authority_check",
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_snapshot_check";

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_authority_check" CHECK (
    "sourceAdjustmentOrdinal" >= 1
    AND "predecessorAdjustmentNoteId" IS DISTINCT FROM "id"
    AND (
      (
        "adjustmentReason" = 'BOOKING_CANCELLATION'
        AND "sourceAdjustmentOrdinal" = 1
        AND "refundTransactionId" IS NOT NULL
        AND "commercialAmendmentId" IS NULL
        AND "targetPricingEvidenceId" IS NULL
        AND "predecessorAdjustmentNoteId" IS NULL
        AND "predecessorSourceAdjustmentOrdinal" IS NULL
      )
      OR
      (
        "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "refundTransactionId" IS NULL
        AND "commercialAmendmentId" IS NOT NULL
        AND "targetPricingEvidenceId" IS NOT NULL
        AND (
          (
            "sourceAdjustmentOrdinal" = 1
            AND "predecessorAdjustmentNoteId" IS NULL
            AND "predecessorSourceAdjustmentOrdinal" IS NULL
          )
          OR
          (
            "sourceAdjustmentOrdinal" >= 2
            AND "predecessorAdjustmentNoteId" IS NOT NULL
            AND "predecessorSourceAdjustmentOrdinal" = "sourceAdjustmentOrdinal" - 1
          )
        )
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
        AND "sourceAdjustmentOrdinal" = 1
        AND "documentSnapshot"->>'schemaVersion' = '1'
        AND "documentSnapshot"->>'refundTransactionId' = "refundTransactionId"::text
        AND NOT ("documentSnapshot" ? 'commercialAmendmentId')
        AND NOT ("documentSnapshot" ? 'targetPricingEvidenceId')
        AND NOT ("documentSnapshot" ? 'sourceAdjustmentOrdinal')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentNoteId')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentDocumentNumber')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentIssuedAt')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentDocumentFingerprint')
        AND NOT ("documentSnapshot" ? 'predecessorAfterPricingFingerprint')
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Booking cancellation'
      )
      OR
      (
        "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "sourceAdjustmentOrdinal" = 1
        AND "documentSnapshot"->>'schemaVersion' = '2'
        AND NOT ("documentSnapshot" ? 'refundTransactionId')
        AND "documentSnapshot"->>'commercialAmendmentId' = "commercialAmendmentId"::text
        AND "documentSnapshot"->>'targetPricingEvidenceId' = "targetPricingEvidenceId"::text
        AND "documentSnapshot"->>'sourceAdjustmentOrdinal' = '1'
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentNoteId')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentDocumentNumber')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentIssuedAt')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentDocumentFingerprint')
        AND NOT ("documentSnapshot" ? 'predecessorAfterPricingFingerprint')
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
      OR
      (
        "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "sourceAdjustmentOrdinal" >= 2
        AND "documentSnapshot"->>'schemaVersion' = '3'
        AND NOT ("documentSnapshot" ? 'refundTransactionId')
        AND "documentSnapshot"->>'commercialAmendmentId' = "commercialAmendmentId"::text
        AND "documentSnapshot"->>'targetPricingEvidenceId' = "targetPricingEvidenceId"::text
        AND "documentSnapshot"->>'sourceAdjustmentOrdinal' = "sourceAdjustmentOrdinal"::text
        AND "documentSnapshot"->>'predecessorAdjustmentNoteId' = "predecessorAdjustmentNoteId"::text
        AND "documentSnapshot"->>'predecessorAdjustmentDocumentNumber' ~ '^AU-ADJ-[0-9]{8,}$'
        AND length("documentSnapshot"->>'predecessorAdjustmentIssuedAt') >= 20
        AND "documentSnapshot"->>'predecessorAdjustmentDocumentFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'predecessorAfterPricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'beforePricingFingerprint' = "documentSnapshot"->>'predecessorAfterPricingFingerprint'
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
  ADD CONSTRAINT "hospitality_adj_notes_predecessor_fkey"
  FOREIGN KEY (
    "predecessorAdjustmentNoteId",
    "bookingId",
    "organizationId",
    "sourceInvoiceId",
    "predecessorSourceAdjustmentOrdinal",
    "adjustmentReason"
  )
  REFERENCES "hospitality_issued_adjustment_notes"(
    "id",
    "bookingId",
    "organizationId",
    "sourceInvoiceId",
    "sourceAdjustmentOrdinal",
    "adjustmentReason"
  )
  ON DELETE RESTRICT ON UPDATE CASCADE;
