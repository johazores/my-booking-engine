ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD COLUMN "adjustmentType" VARCHAR(16) NOT NULL DEFAULT 'DECREASING',
  ADD COLUMN "increaseSubtotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "increaseTaxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "increaseTotalMinor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "hospitality_issued_adjustment_notes"
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_money_check",
  DROP CONSTRAINT "hospitality_issued_adjustment_notes_snapshot_check";

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_issued_adjustment_notes_money_check" CHECK (
    (
      "adjustmentType" = 'DECREASING'
      AND "decreaseSubtotalMinor" > 0
      AND "decreaseTaxMinor" > 0
      AND "decreaseTotalMinor" = "decreaseSubtotalMinor" + "decreaseTaxMinor"
      AND "decreaseTaxMinor" * 11 = "decreaseTotalMinor"
      AND "increaseSubtotalMinor" = 0
      AND "increaseTaxMinor" = 0
      AND "increaseTotalMinor" = 0
    )
    OR
    (
      "adjustmentType" = 'INCREASING'
      AND "decreaseSubtotalMinor" = 0
      AND "decreaseTaxMinor" = 0
      AND "decreaseTotalMinor" = 0
      AND "increaseSubtotalMinor" > 0
      AND "increaseTaxMinor" > 0
      AND "increaseTotalMinor" = "increaseSubtotalMinor" + "increaseTaxMinor"
      AND "increaseTaxMinor" * 11 = "increaseTotalMinor"
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
