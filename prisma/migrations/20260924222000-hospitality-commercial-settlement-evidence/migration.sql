-- Freeze the exact provider-neutral payment ledger observed when a commercial Australian
-- adjustment note is issued. Historical legal authority can then replay issue-time payment
-- status without treating later provider lifecycle changes as if they rewrote the document.

CREATE TABLE "hospitality_commercial_settlement_evidence" (
    "adjustmentNoteId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "sourceInvoiceId" UUID NOT NULL,
    "commercialAmendmentId" UUID NOT NULL,
    "sourceAdjustmentOrdinal" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "transactionCount" INTEGER NOT NULL,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospitality_commercial_settlement_evidence_pkey"
      PRIMARY KEY ("adjustmentNoteId"),
    CONSTRAINT "hospitality_commercial_settlement_evidence_shape_check"
      CHECK (
        "schemaVersion" = 1
        AND "sourceAdjustmentOrdinal" >= 1
        AND "transactionCount" BETWEEN 1 AND 5000
      )
);

CREATE UNIQUE INDEX "hospitality_commercial_settlement_evidence_scope_key"
  ON "hospitality_commercial_settlement_evidence"(
    "adjustmentNoteId", "organizationId", "bookingId"
  );

CREATE INDEX "hospitality_commercial_settlement_evidence_source_idx"
  ON "hospitality_commercial_settlement_evidence"(
    "organizationId", "bookingId", "sourceInvoiceId", "sourceAdjustmentOrdinal"
  );

CREATE FUNCTION sf_validate_hospitality_commercial_settlement_evidence_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    note_created_at TIMESTAMPTZ;
BEGIN
    SELECT note."createdAt"
      INTO note_created_at
      FROM "hospitality_issued_adjustment_notes" note
     WHERE note."id" = NEW."adjustmentNoteId"
       AND note."organizationId" = NEW."organizationId"
       AND note."bookingId" = NEW."bookingId"
       AND note."sourceInvoiceId" = NEW."sourceInvoiceId"
       AND note."commercialAmendmentId" = NEW."commercialAmendmentId"
       AND note."sourceAdjustmentOrdinal" = NEW."sourceAdjustmentOrdinal"
       AND note."adjustmentReason" = 'COMMERCIAL_AMENDMENT'
       AND (note."documentSnapshot"->>'schemaVersion') IN ('2', '3', '4', '5');

    IF note_created_at IS NULL THEN
        RAISE EXCEPTION 'commercial settlement evidence does not match an issued tenant-scoped adjustment note'
            USING ERRCODE = '23514';
    END IF;

    -- Deliberately reject later backfills. Historical mutable provider status cannot be
    -- reconstructed into truthful issue-time evidence after the original issuance transaction.
    IF NEW."capturedAt" < note_created_at - INTERVAL '1 minute'
       OR NEW."capturedAt" > note_created_at + INTERVAL '10 minutes' THEN
        RAISE EXCEPTION 'commercial settlement evidence must be captured with the issued adjustment note'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_commercial_settlement_evidence_insert_guard
BEFORE INSERT ON "hospitality_commercial_settlement_evidence"
FOR EACH ROW
EXECUTE FUNCTION sf_validate_hospitality_commercial_settlement_evidence_insert();

CREATE TABLE "hospitality_commercial_settlement_evidence_transactions" (
    "settlementEvidenceId" UUID NOT NULL,
    "paymentTransactionId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "commercialAmendmentId" UUID,
    "kind" "PaymentTransactionKind" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL,
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "sourceProviderReference" VARCHAR(160),
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "sourceCreatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hospitality_commercial_settlement_evidence_tx_pkey"
      PRIMARY KEY ("settlementEvidenceId", "paymentTransactionId"),
    CONSTRAINT "hospitality_commercial_settlement_evidence_tx_money_check"
      CHECK ("amountMinor" > 0),
    CONSTRAINT "hospitality_commercial_settlement_evidence_tx_text_check"
      CHECK (
        btrim("providerCode") <> ''
        AND btrim("providerReference") <> ''
        AND ("sourceProviderReference" IS NULL OR btrim("sourceProviderReference") <> '')
        AND "currency" ~ '^[A-Z]{3}$'
      )
);

CREATE INDEX "hospitality_commercial_settlement_evidence_tx_scope_idx"
  ON "hospitality_commercial_settlement_evidence_transactions"(
    "organizationId", "bookingId", "sourceCreatedAt", "paymentTransactionId"
  );

ALTER TABLE "hospitality_commercial_settlement_evidence_transactions"
  ADD CONSTRAINT "hospitality_commercial_settlement_evidence_tx_scope_fkey"
  FOREIGN KEY ("settlementEvidenceId", "organizationId", "bookingId")
  REFERENCES "hospitality_commercial_settlement_evidence"(
    "adjustmentNoteId", "organizationId", "bookingId"
  )
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_check_hospitality_commercial_settlement_evidence_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    evidence_id UUID;
    expected_count INTEGER;
    actual_count INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'hospitality_commercial_settlement_evidence' THEN
        evidence_id := NEW."adjustmentNoteId";
    ELSE
        evidence_id := NEW."settlementEvidenceId";
    END IF;

    SELECT evidence."transactionCount"
      INTO expected_count
      FROM "hospitality_commercial_settlement_evidence" evidence
     WHERE evidence."adjustmentNoteId" = evidence_id;

    IF expected_count IS NULL THEN
        RAISE EXCEPTION 'commercial settlement evidence count has no immutable header'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::INTEGER
      INTO actual_count
      FROM "hospitality_commercial_settlement_evidence_transactions" frozen
     WHERE frozen."settlementEvidenceId" = evidence_id;

    IF actual_count IS DISTINCT FROM expected_count THEN
        RAISE EXCEPTION 'commercial settlement evidence transaction count does not match immutable header'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_commercial_settlement_evidence_count_guard
AFTER INSERT ON "hospitality_commercial_settlement_evidence"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_check_hospitality_commercial_settlement_evidence_count();

CREATE CONSTRAINT TRIGGER hospitality_commercial_settlement_evidence_tx_count_guard
AFTER INSERT ON "hospitality_commercial_settlement_evidence_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_check_hospitality_commercial_settlement_evidence_count();

CREATE FUNCTION sf_capture_hospitality_commercial_settlement_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    snapshot_schema_version INTEGER;
    captured_transaction_count INTEGER;
BEGIN
    IF NEW."adjustmentReason" IS DISTINCT FROM 'COMMERCIAL_AMENDMENT' THEN
        RETURN NEW;
    END IF;

    BEGIN
        snapshot_schema_version := (NEW."documentSnapshot"->>'schemaVersion')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'commercial adjustment note has invalid settlement-evidence schema authority'
            USING ERRCODE = '23514';
    END;

    IF snapshot_schema_version NOT IN (2, 3, 4, 5)
       OR NEW."commercialAmendmentId" IS NULL THEN
        RAISE EXCEPTION 'commercial adjustment note is outside the settlement-evidence capture contract'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::INTEGER
      INTO captured_transaction_count
      FROM "payment_transactions" payment
     WHERE payment."organizationId" = NEW."organizationId"
       AND payment."bookingId" = NEW."bookingId"
       AND payment."createdAt" <= NEW."issuedAt"
       AND (
         payment."commercialAmendmentId" IS NULL
         OR payment."commercialAmendmentId" IN (
           SELECT legal_note."commercialAmendmentId"
             FROM "hospitality_issued_adjustment_notes" legal_note
            WHERE legal_note."organizationId" = NEW."organizationId"
              AND legal_note."bookingId" = NEW."bookingId"
              AND legal_note."sourceInvoiceId" = NEW."sourceInvoiceId"
              AND legal_note."adjustmentReason" = 'COMMERCIAL_AMENDMENT'
              AND legal_note."sourceAdjustmentOrdinal" <= NEW."sourceAdjustmentOrdinal"
              AND legal_note."commercialAmendmentId" IS NOT NULL
         )
       );

    IF captured_transaction_count < 1 OR captured_transaction_count > 5000 THEN
        RAISE EXCEPTION 'commercial adjustment-note settlement evidence must contain between 1 and 5000 payment transactions'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO "hospitality_commercial_settlement_evidence" (
      "adjustmentNoteId",
      "organizationId",
      "bookingId",
      "sourceInvoiceId",
      "commercialAmendmentId",
      "sourceAdjustmentOrdinal",
      "schemaVersion",
      "issuedAt",
      "transactionCount"
    ) VALUES (
      NEW."id",
      NEW."organizationId",
      NEW."bookingId",
      NEW."sourceInvoiceId",
      NEW."commercialAmendmentId",
      NEW."sourceAdjustmentOrdinal",
      1,
      NEW."issuedAt",
      captured_transaction_count
    );

    INSERT INTO "hospitality_commercial_settlement_evidence_transactions" (
      "settlementEvidenceId",
      "paymentTransactionId",
      "organizationId",
      "bookingId",
      "commercialAmendmentId",
      "kind",
      "status",
      "providerCode",
      "providerReference",
      "sourceProviderReference",
      "currency",
      "amountMinor",
      "sourceCreatedAt"
    )
    SELECT
      NEW."id",
      payment."id",
      payment."organizationId",
      payment."bookingId",
      payment."commercialAmendmentId",
      payment."kind",
      payment."status",
      payment."providerCode",
      payment."providerReference",
      payment."sourceProviderReference",
      payment."currency",
      payment."amountMinor",
      payment."createdAt"
    FROM "payment_transactions" payment
    WHERE payment."organizationId" = NEW."organizationId"
      AND payment."bookingId" = NEW."bookingId"
      AND payment."createdAt" <= NEW."issuedAt"
      AND (
        payment."commercialAmendmentId" IS NULL
        OR payment."commercialAmendmentId" IN (
          SELECT legal_note."commercialAmendmentId"
            FROM "hospitality_issued_adjustment_notes" legal_note
           WHERE legal_note."organizationId" = NEW."organizationId"
             AND legal_note."bookingId" = NEW."bookingId"
             AND legal_note."sourceInvoiceId" = NEW."sourceInvoiceId"
             AND legal_note."adjustmentReason" = 'COMMERCIAL_AMENDMENT'
             AND legal_note."sourceAdjustmentOrdinal" <= NEW."sourceAdjustmentOrdinal"
             AND legal_note."commercialAmendmentId" IS NOT NULL
        )
      )
    ORDER BY payment."createdAt" ASC, payment."id" ASC;

    GET DIAGNOSTICS captured_transaction_count = ROW_COUNT;

    IF captured_transaction_count IS DISTINCT FROM (
      SELECT evidence."transactionCount"
      FROM "hospitality_commercial_settlement_evidence" evidence
      WHERE evidence."adjustmentNoteId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'commercial adjustment-note settlement evidence changed during capture'
            USING ERRCODE = '40001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_commercial_settlement_evidence_capture
AFTER INSERT ON "hospitality_issued_adjustment_notes"
FOR EACH ROW
EXECUTE FUNCTION sf_capture_hospitality_commercial_settlement_evidence();

CREATE FUNCTION sf_guard_hospitality_commercial_settlement_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'hospitality commercial settlement evidence is immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER hospitality_commercial_settlement_evidence_mutation_guard
BEFORE UPDATE OR DELETE ON "hospitality_commercial_settlement_evidence"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_commercial_settlement_evidence_mutation();

CREATE TRIGGER hospitality_commercial_settlement_evidence_tx_mutation_guard
BEFORE UPDATE OR DELETE ON "hospitality_commercial_settlement_evidence_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_commercial_settlement_evidence_mutation();

-- Existing schemas 2-5 are intentionally not backfilled. Their original issue-time payment
-- statuses cannot be reconstructed from mutable current provider lifecycle state. Only notes
-- issued after this migration receive schema-version-1 frozen settlement evidence.
