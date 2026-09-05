-- Cancellation after a verified commercial-amendment chain is a terminal legal step.
-- Replace the reason-scoped predecessor FK with the same tenant/booking/source/ordinal boundary
-- without adjustmentReason so a BOOKING_CANCELLATION can follow a COMMERCIAL_AMENDMENT.
ALTER TABLE "hospitality_issued_adjustment_notes"
  DROP CONSTRAINT "hospitality_adj_notes_predecessor_fkey";

CREATE UNIQUE INDEX "hospitality_adj_notes_chain_reference_any_reason_key"
  ON "hospitality_issued_adjustment_notes"(
    "id", "bookingId", "organizationId", "sourceInvoiceId", "sourceAdjustmentOrdinal"
  );

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_predecessor_fkey"
  FOREIGN KEY (
    "predecessorAdjustmentNoteId", "bookingId", "organizationId", "sourceInvoiceId", "predecessorSourceAdjustmentOrdinal"
  )
  REFERENCES "hospitality_issued_adjustment_notes"(
    "id", "bookingId", "organizationId", "sourceInvoiceId", "sourceAdjustmentOrdinal"
  )
  ON DELETE RESTRICT ON UPDATE CASCADE;

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
        "adjustmentReason" = 'BOOKING_CANCELLATION'
        AND "sourceAdjustmentOrdinal" >= 2
        AND "refundTransactionId" IS NULL
        AND "commercialAmendmentId" IS NULL
        AND "targetPricingEvidenceId" IS NULL
        AND "predecessorAdjustmentNoteId" IS NOT NULL
        AND "predecessorSourceAdjustmentOrdinal" = "sourceAdjustmentOrdinal" - 1
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
    AND "documentSnapshot"->>'adjustmentType' = "adjustmentType"
    AND "documentSnapshot"->>'adjustmentReason' = "adjustmentReason"
    AND "documentSnapshot"->>'organizationId' = "organizationId"::text
    AND "documentSnapshot"->>'bookingId' = "bookingId"::text
    AND "documentSnapshot"->>'sourceInvoiceId' = "sourceInvoiceId"::text
    AND "documentSnapshot"->>'documentNumber' = "documentNumber"
    AND "documentSnapshot"->>'sequenceValue' = "sequenceValue"::text
    AND "documentSnapshot"->>'currency' = "currency"
    AND "documentSnapshot"->>'sourceInvoiceFingerprint' = "sourceInvoiceFingerprint"
    AND "documentSnapshot"->>'issuerFingerprint' = "issuerFingerprint"
    AND "documentSnapshot"->>'recipientFingerprint' = "recipientFingerprint"
    AND jsonb_typeof("documentSnapshot"->'issuer') = 'object'
    AND jsonb_typeof("documentSnapshot"->'recipient') = 'object'
    AND jsonb_typeof("documentSnapshot"->'australianTax') = 'object'
    AND "documentSnapshot"->'australianTax'->>'documentLabel' = 'Adjustment note'
    AND (
      (
        "adjustmentType" = 'DECREASING'
        AND "adjustmentReason" = 'BOOKING_CANCELLATION'
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
        AND NOT ("documentSnapshot" ? 'refundAuthorities')
        AND NOT ("documentSnapshot" ? 'increaseSubtotalMinor')
        AND NOT ("documentSnapshot" ? 'increaseTaxMinor')
        AND NOT ("documentSnapshot" ? 'increaseTotalMinor')
        AND "documentSnapshot"->>'decreaseSubtotalMinor' = "decreaseSubtotalMinor"::text
        AND "documentSnapshot"->>'decreaseTaxMinor' = "decreaseTaxMinor"::text
        AND "documentSnapshot"->>'decreaseTotalMinor' = "decreaseTotalMinor"::text
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Booking cancellation'
      )
      OR
      (
        "adjustmentType" = 'DECREASING'
        AND "adjustmentReason" = 'BOOKING_CANCELLATION'
        AND "sourceAdjustmentOrdinal" >= 2
        AND "refundTransactionId" IS NULL
        AND "commercialAmendmentId" IS NULL
        AND "targetPricingEvidenceId" IS NULL
        AND "predecessorAdjustmentNoteId" IS NOT NULL
        AND "predecessorSourceAdjustmentOrdinal" = "sourceAdjustmentOrdinal" - 1
        AND "documentSnapshot"->>'schemaVersion' = '6'
        AND NOT ("documentSnapshot" ? 'refundTransactionId')
        AND "documentSnapshot"->>'sourceAdjustmentOrdinal' = "sourceAdjustmentOrdinal"::text
        AND "documentSnapshot"->>'predecessorAdjustmentNoteId' = "predecessorAdjustmentNoteId"::text
        AND "documentSnapshot"->>'predecessorAdjustmentDocumentNumber' ~ '^AU-ADJ-[0-9]{8,}$'
        AND length("documentSnapshot"->>'predecessorAdjustmentIssuedAt') >= 20
        AND "documentSnapshot"->>'predecessorAdjustmentDocumentFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'predecessorAfterPricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'beforePricingFingerprint' = "documentSnapshot"->>'predecessorAfterPricingFingerprint'
        AND "documentSnapshot"->>'beforePricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND ("documentSnapshot"->>'beforeTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'beforeTaxMinor') ~ '^[0-9]+$'
        AND "documentSnapshot"->>'afterTotalMinor' = '0'
        AND "documentSnapshot"->>'afterTaxMinor' = '0'
        AND ("documentSnapshot"->>'beforeTotalMinor')::bigint = "decreaseTotalMinor"
        AND ("documentSnapshot"->>'beforeTaxMinor')::bigint = "decreaseTaxMinor"
        AND ("documentSnapshot"->>'beforeTaxMinor')::bigint * 11 = ("documentSnapshot"->>'beforeTotalMinor')::bigint
        AND jsonb_typeof("documentSnapshot"->'refundAuthorities') = 'array'
        AND jsonb_array_length("documentSnapshot"->'refundAuthorities') BETWEEN 1 AND 256
        AND NOT ("documentSnapshot" ? 'commercialAmendmentId')
        AND NOT ("documentSnapshot" ? 'targetPricingEvidenceId')
        AND NOT ("documentSnapshot" ? 'increaseSubtotalMinor')
        AND NOT ("documentSnapshot" ? 'increaseTaxMinor')
        AND NOT ("documentSnapshot" ? 'increaseTotalMinor')
        AND "documentSnapshot"->>'decreaseSubtotalMinor' = "decreaseSubtotalMinor"::text
        AND "documentSnapshot"->>'decreaseTaxMinor' = "decreaseTaxMinor"::text
        AND "documentSnapshot"->>'decreaseTotalMinor' = "decreaseTotalMinor"::text
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Booking cancellation'
      )
      OR
      (
        "adjustmentType" = 'DECREASING'
        AND "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
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
        AND NOT ("documentSnapshot" ? 'refundAuthorities')
        AND NOT ("documentSnapshot" ? 'increaseSubtotalMinor')
        AND NOT ("documentSnapshot" ? 'increaseTaxMinor')
        AND NOT ("documentSnapshot" ? 'increaseTotalMinor')
        AND "documentSnapshot"->>'decreaseSubtotalMinor' = "decreaseSubtotalMinor"::text
        AND "documentSnapshot"->>'decreaseTaxMinor' = "decreaseTaxMinor"::text
        AND "documentSnapshot"->>'decreaseTotalMinor' = "decreaseTotalMinor"::text
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
        "adjustmentType" = 'DECREASING'
        AND "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
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
        AND NOT ("documentSnapshot" ? 'refundAuthorities')
        AND NOT ("documentSnapshot" ? 'increaseSubtotalMinor')
        AND NOT ("documentSnapshot" ? 'increaseTaxMinor')
        AND NOT ("documentSnapshot" ? 'increaseTotalMinor')
        AND "documentSnapshot"->>'decreaseSubtotalMinor' = "decreaseSubtotalMinor"::text
        AND "documentSnapshot"->>'decreaseTaxMinor' = "decreaseTaxMinor"::text
        AND "documentSnapshot"->>'decreaseTotalMinor' = "decreaseTotalMinor"::text
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
        "adjustmentType" = 'INCREASING'
        AND "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "sourceAdjustmentOrdinal" = 1
        AND "predecessorAdjustmentNoteId" IS NULL
        AND "predecessorSourceAdjustmentOrdinal" IS NULL
        AND "documentSnapshot"->>'schemaVersion' = '4'
        AND NOT ("documentSnapshot" ? 'refundTransactionId')
        AND "documentSnapshot"->>'commercialAmendmentId' = "commercialAmendmentId"::text
        AND "documentSnapshot"->>'targetPricingEvidenceId' = "targetPricingEvidenceId"::text
        AND "documentSnapshot"->>'sourceAdjustmentOrdinal' = '1'
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentNoteId')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentDocumentNumber')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentIssuedAt')
        AND NOT ("documentSnapshot" ? 'predecessorAdjustmentDocumentFingerprint')
        AND NOT ("documentSnapshot" ? 'predecessorAfterPricingFingerprint')
        AND NOT ("documentSnapshot" ? 'refundAuthorities')
        AND NOT ("documentSnapshot" ? 'decreaseSubtotalMinor')
        AND NOT ("documentSnapshot" ? 'decreaseTaxMinor')
        AND NOT ("documentSnapshot" ? 'decreaseTotalMinor')
        AND "documentSnapshot"->>'increaseSubtotalMinor' = "increaseSubtotalMinor"::text
        AND "documentSnapshot"->>'increaseTaxMinor' = "increaseTaxMinor"::text
        AND "documentSnapshot"->>'increaseTotalMinor' = "increaseTotalMinor"::text
        AND "documentSnapshot"->>'beforePricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'afterPricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND ("documentSnapshot"->>'beforeTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'beforeTaxMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTaxMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTotalMinor')::bigint > ("documentSnapshot"->>'beforeTotalMinor')::bigint
        AND ("documentSnapshot"->>'afterTotalMinor')::bigint - ("documentSnapshot"->>'beforeTotalMinor')::bigint = "increaseTotalMinor"
        AND ("documentSnapshot"->>'afterTaxMinor')::bigint - ("documentSnapshot"->>'beforeTaxMinor')::bigint = "increaseTaxMinor"
        AND ("documentSnapshot"->>'beforeTaxMinor')::bigint * 11 = ("documentSnapshot"->>'beforeTotalMinor')::bigint
        AND ("documentSnapshot"->>'afterTaxMinor')::bigint * 11 = ("documentSnapshot"->>'afterTotalMinor')::bigint
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Commercial booking amendment'
      )
      OR
      (
        "adjustmentType" = 'INCREASING'
        AND "adjustmentReason" = 'COMMERCIAL_AMENDMENT'
        AND "sourceAdjustmentOrdinal" >= 2
        AND "predecessorAdjustmentNoteId" IS NOT NULL
        AND "predecessorSourceAdjustmentOrdinal" = "sourceAdjustmentOrdinal" - 1
        AND "documentSnapshot"->>'schemaVersion' = '5'
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
        AND NOT ("documentSnapshot" ? 'refundAuthorities')
        AND NOT ("documentSnapshot" ? 'decreaseSubtotalMinor')
        AND NOT ("documentSnapshot" ? 'decreaseTaxMinor')
        AND NOT ("documentSnapshot" ? 'decreaseTotalMinor')
        AND "documentSnapshot"->>'increaseSubtotalMinor' = "increaseSubtotalMinor"::text
        AND "documentSnapshot"->>'increaseTaxMinor' = "increaseTaxMinor"::text
        AND "documentSnapshot"->>'increaseTotalMinor' = "increaseTotalMinor"::text
        AND "documentSnapshot"->>'beforePricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND "documentSnapshot"->>'afterPricingFingerprint' ~ '^[a-f0-9]{64}$'
        AND ("documentSnapshot"->>'beforeTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTotalMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'beforeTaxMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTaxMinor') ~ '^[0-9]+$'
        AND ("documentSnapshot"->>'afterTotalMinor')::bigint > ("documentSnapshot"->>'beforeTotalMinor')::bigint
        AND ("documentSnapshot"->>'afterTotalMinor')::bigint - ("documentSnapshot"->>'beforeTotalMinor')::bigint = "increaseTotalMinor"
        AND ("documentSnapshot"->>'afterTaxMinor')::bigint - ("documentSnapshot"->>'beforeTaxMinor')::bigint = "increaseTaxMinor"
        AND ("documentSnapshot"->>'beforeTaxMinor')::bigint * 11 = ("documentSnapshot"->>'beforeTotalMinor')::bigint
        AND ("documentSnapshot"->>'afterTaxMinor')::bigint * 11 = ("documentSnapshot"->>'afterTotalMinor')::bigint
        AND "documentSnapshot"->'australianTax'->>'adjustmentReasonLabel' = 'Commercial booking amendment'
      )
    )
  );
