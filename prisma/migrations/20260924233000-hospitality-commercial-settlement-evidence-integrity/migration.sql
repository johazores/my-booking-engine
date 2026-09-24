-- Harden frozen commercial settlement evidence against direct-write drift.
-- The original capture trigger already records evidence in the adjustment-note issuance
-- transaction. These guards make the database independently prove that the retained header
-- matches the immutable legal note, every frozen child row matches the source payment row at
-- capture time, and later frozen ledgers never drop payment identities captured earlier.

CREATE OR REPLACE FUNCTION sf_validate_hospitality_commercial_settlement_evidence_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    note_created_at TIMESTAMPTZ;
    note_issued_at TIMESTAMPTZ;
BEGIN
    SELECT note."createdAt", note."issuedAt"
      INTO note_created_at, note_issued_at
      FROM "hospitality_issued_adjustment_notes" note
     WHERE note."id" = NEW."adjustmentNoteId"
       AND note."organizationId" = NEW."organizationId"
       AND note."bookingId" = NEW."bookingId"
       AND note."sourceInvoiceId" = NEW."sourceInvoiceId"
       AND note."commercialAmendmentId" = NEW."commercialAmendmentId"
       AND note."sourceAdjustmentOrdinal" = NEW."sourceAdjustmentOrdinal"
       AND note."adjustmentReason" = 'COMMERCIAL_AMENDMENT'
       AND (note."documentSnapshot"->>'schemaVersion') IN ('2', '3', '4', '5');

    IF note_created_at IS NULL OR note_issued_at IS NULL THEN
        RAISE EXCEPTION 'commercial settlement evidence does not match an issued tenant-scoped adjustment note'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."issuedAt" IS DISTINCT FROM note_issued_at THEN
        RAISE EXCEPTION 'commercial settlement evidence issue time must match the immutable adjustment note'
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

CREATE FUNCTION sf_validate_hospitality_commercial_settlement_tx_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    evidence_source_invoice_id UUID;
    evidence_source_adjustment_ordinal INTEGER;
    evidence_issued_at TIMESTAMPTZ;
    source_payment_matches BOOLEAN;
    amendment_is_in_legal_prefix BOOLEAN;
BEGIN
    SELECT evidence."sourceInvoiceId",
           evidence."sourceAdjustmentOrdinal",
           evidence."issuedAt"
      INTO evidence_source_invoice_id,
           evidence_source_adjustment_ordinal,
           evidence_issued_at
      FROM "hospitality_commercial_settlement_evidence" evidence
     WHERE evidence."adjustmentNoteId" = NEW."settlementEvidenceId"
       AND evidence."organizationId" = NEW."organizationId"
       AND evidence."bookingId" = NEW."bookingId";

    IF evidence_source_invoice_id IS NULL OR evidence_issued_at IS NULL THEN
        RAISE EXCEPTION 'commercial settlement transaction has no tenant-scoped immutable header'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."sourceCreatedAt" > evidence_issued_at THEN
        RAISE EXCEPTION 'commercial settlement transaction cannot postdate its legal evidence issue time'
            USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM "payment_transactions" payment
       WHERE payment."id" = NEW."paymentTransactionId"
         AND payment."organizationId" = NEW."organizationId"
         AND payment."bookingId" = NEW."bookingId"
         AND payment."commercialAmendmentId" IS NOT DISTINCT FROM NEW."commercialAmendmentId"
         AND payment."kind" = NEW."kind"
         AND payment."status" = NEW."status"
         AND payment."providerCode" = NEW."providerCode"
         AND payment."providerReference" = NEW."providerReference"
         AND payment."sourceProviderReference" IS NOT DISTINCT FROM NEW."sourceProviderReference"
         AND payment."currency" = NEW."currency"
         AND payment."amountMinor" = NEW."amountMinor"
         AND payment."createdAt" = NEW."sourceCreatedAt"
    ) INTO source_payment_matches;

    IF NOT source_payment_matches THEN
        RAISE EXCEPTION 'commercial settlement transaction must exactly match source payment evidence at capture time'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."commercialAmendmentId" IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
            FROM "hospitality_issued_adjustment_notes" legal_note
           WHERE legal_note."organizationId" = NEW."organizationId"
             AND legal_note."bookingId" = NEW."bookingId"
             AND legal_note."sourceInvoiceId" = evidence_source_invoice_id
             AND legal_note."adjustmentReason" = 'COMMERCIAL_AMENDMENT'
             AND legal_note."commercialAmendmentId" = NEW."commercialAmendmentId"
             AND legal_note."sourceAdjustmentOrdinal" <= evidence_source_adjustment_ordinal
        ) INTO amendment_is_in_legal_prefix;

        IF NOT amendment_is_in_legal_prefix THEN
            RAISE EXCEPTION 'commercial settlement transaction amendment is outside the immutable legal chain prefix'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_commercial_settlement_evidence_tx_insert_guard
BEFORE INSERT ON "hospitality_commercial_settlement_evidence_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_validate_hospitality_commercial_settlement_tx_insert();

CREATE FUNCTION sf_check_hospitality_commercial_settlement_evidence_continuity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    previous_evidence_id UUID;
    next_evidence_id UUID;
    missing_payment_count INTEGER;
BEGIN
    SELECT evidence."adjustmentNoteId"
      INTO previous_evidence_id
      FROM "hospitality_commercial_settlement_evidence" evidence
     WHERE evidence."organizationId" = NEW."organizationId"
       AND evidence."bookingId" = NEW."bookingId"
       AND evidence."sourceInvoiceId" = NEW."sourceInvoiceId"
       AND evidence."sourceAdjustmentOrdinal" < NEW."sourceAdjustmentOrdinal"
     ORDER BY evidence."sourceAdjustmentOrdinal" DESC
     LIMIT 1;

    IF previous_evidence_id IS NOT NULL THEN
        SELECT count(*)::INTEGER
          INTO missing_payment_count
          FROM "hospitality_commercial_settlement_evidence_transactions" previous_tx
          LEFT JOIN "hospitality_commercial_settlement_evidence_transactions" current_tx
            ON current_tx."settlementEvidenceId" = NEW."adjustmentNoteId"
           AND current_tx."paymentTransactionId" = previous_tx."paymentTransactionId"
         WHERE previous_tx."settlementEvidenceId" = previous_evidence_id
           AND current_tx."paymentTransactionId" IS NULL;

        IF missing_payment_count > 0 THEN
            RAISE EXCEPTION 'commercial settlement evidence cannot drop previously frozen payment identities'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Also protect an out-of-order/manual header insert between already-frozen ordinals.
    SELECT evidence."adjustmentNoteId"
      INTO next_evidence_id
      FROM "hospitality_commercial_settlement_evidence" evidence
     WHERE evidence."organizationId" = NEW."organizationId"
       AND evidence."bookingId" = NEW."bookingId"
       AND evidence."sourceInvoiceId" = NEW."sourceInvoiceId"
       AND evidence."sourceAdjustmentOrdinal" > NEW."sourceAdjustmentOrdinal"
     ORDER BY evidence."sourceAdjustmentOrdinal" ASC
     LIMIT 1;

    IF next_evidence_id IS NOT NULL THEN
        SELECT count(*)::INTEGER
          INTO missing_payment_count
          FROM "hospitality_commercial_settlement_evidence_transactions" current_tx
          LEFT JOIN "hospitality_commercial_settlement_evidence_transactions" next_tx
            ON next_tx."settlementEvidenceId" = next_evidence_id
           AND next_tx."paymentTransactionId" = current_tx."paymentTransactionId"
         WHERE current_tx."settlementEvidenceId" = NEW."adjustmentNoteId"
           AND next_tx."paymentTransactionId" IS NULL;

        IF missing_payment_count > 0 THEN
            RAISE EXCEPTION 'commercial settlement evidence cannot introduce membership missing from a later frozen ledger'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_commercial_settlement_evidence_continuity_guard
AFTER INSERT ON "hospitality_commercial_settlement_evidence"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_check_hospitality_commercial_settlement_evidence_continuity();
