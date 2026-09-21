DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "hospitality_invoice_number_sequences" number_sequence
         WHERE number_sequence."nextValue" < 1
    ) THEN
        RAISE EXCEPTION 'hospitality invoice number sequence contains a non-positive next value'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "hospitality_issued_invoices" invoice
         WHERE invoice."documentType" <> 'TAX_INVOICE'
            OR invoice."sequenceValue" < 1
            OR invoice."documentNumber" <> (
                'AU-TAX-' || LPAD(
                    invoice."sequenceValue"::text,
                    GREATEST(8, LENGTH(invoice."sequenceValue"::text)),
                    '0'
                )
            )
    ) THEN
        RAISE EXCEPTION 'hospitality issued tax invoice numbering evidence is invalid'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "hospitality_issued_adjustment_notes" note
         WHERE note."documentType" <> 'ADJUSTMENT_NOTE'
            OR note."sequenceValue" < 1
            OR note."documentNumber" <> (
                'AU-ADJ-' || LPAD(
                    note."sequenceValue"::text,
                    GREATEST(8, LENGTH(note."sequenceValue"::text)),
                    '0'
                )
            )
    ) THEN
        RAISE EXCEPTION 'hospitality issued adjustment-note numbering evidence is invalid'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "hospitality_invoice_number_sequences" number_sequence
          LEFT JOIN LATERAL (
              SELECT COUNT(*)::bigint AS issued_count,
                     MIN(invoice."sequenceValue") AS minimum_value,
                     MAX(invoice."sequenceValue") AS maximum_value
                FROM "hospitality_issued_invoices" invoice
               WHERE invoice."organizationId" = number_sequence."organizationId"
                 AND invoice."jurisdictionCode" = number_sequence."jurisdictionCode"
                 AND invoice."documentType" = number_sequence."documentType"
          ) invoice_history ON TRUE
          LEFT JOIN LATERAL (
              SELECT COUNT(*)::bigint AS issued_count,
                     MIN(note."sequenceValue") AS minimum_value,
                     MAX(note."sequenceValue") AS maximum_value
                FROM "hospitality_issued_adjustment_notes" note
               WHERE note."organizationId" = number_sequence."organizationId"
                 AND note."jurisdictionCode" = number_sequence."jurisdictionCode"
                 AND note."documentType" = number_sequence."documentType"
          ) adjustment_history ON TRUE
         WHERE number_sequence."documentType" IN ('TAX_INVOICE', 'ADJUSTMENT_NOTE')
           AND (
               CASE number_sequence."documentType"
                   WHEN 'TAX_INVOICE' THEN
                       invoice_history.issued_count = 0 AND number_sequence."nextValue" <> 1
                       OR invoice_history.issued_count > 0 AND (
                           invoice_history.minimum_value <> 1
                           OR invoice_history.maximum_value <> invoice_history.issued_count
                           OR number_sequence."nextValue" <> invoice_history.maximum_value + 1
                       )
                   WHEN 'ADJUSTMENT_NOTE' THEN
                       adjustment_history.issued_count = 0 AND number_sequence."nextValue" <> 1
                       OR adjustment_history.issued_count > 0 AND (
                           adjustment_history.minimum_value <> 1
                           OR adjustment_history.maximum_value <> adjustment_history.issued_count
                           OR number_sequence."nextValue" <> adjustment_history.maximum_value + 1
                       )
                   ELSE FALSE
               END
           )
    ) THEN
        RAISE EXCEPTION 'hospitality invoice number sequence does not match issued legal-document history'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "hospitality_issued_invoices" invoice
          LEFT JOIN "hospitality_invoice_number_sequences" number_sequence
            ON number_sequence."organizationId" = invoice."organizationId"
           AND number_sequence."jurisdictionCode" = invoice."jurisdictionCode"
           AND number_sequence."documentType" = invoice."documentType"
         WHERE number_sequence."organizationId" IS NULL
    ) OR EXISTS (
        SELECT 1
          FROM "hospitality_issued_adjustment_notes" note
          LEFT JOIN "hospitality_invoice_number_sequences" number_sequence
            ON number_sequence."organizationId" = note."organizationId"
           AND number_sequence."jurisdictionCode" = note."jurisdictionCode"
           AND number_sequence."documentType" = note."documentType"
         WHERE number_sequence."organizationId" IS NULL
    ) THEN
        RAISE EXCEPTION 'issued hospitality legal document is missing its invoice number sequence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE "hospitality_invoice_number_sequences"
    ADD CONSTRAINT hospitality_invoice_number_sequences_supported_document_type_check
    CHECK ("documentType" IN ('TAX_INVOICE', 'ADJUSTMENT_NOTE')),
    ADD CONSTRAINT hospitality_invoice_number_sequences_next_positive_check
    CHECK ("nextValue" >= 1);

ALTER TABLE "hospitality_issued_invoices"
    ADD CONSTRAINT hospitality_issued_invoices_document_type_check
    CHECK ("documentType" = 'TAX_INVOICE'),
    ADD CONSTRAINT hospitality_issued_invoices_sequence_positive_check
    CHECK ("sequenceValue" >= 1),
    ADD CONSTRAINT hospitality_issued_invoices_number_sequence_identity_check
    CHECK (
        "documentNumber" = (
            'AU-TAX-' || LPAD(
                "sequenceValue"::text,
                GREATEST(8, LENGTH("sequenceValue"::text)),
                '0'
            )
        )
    );

ALTER TABLE "hospitality_issued_adjustment_notes"
    ADD CONSTRAINT hospitality_issued_adjustment_notes_document_type_check
    CHECK ("documentType" = 'ADJUSTMENT_NOTE'),
    ADD CONSTRAINT hospitality_issued_adjustment_notes_sequence_positive_check
    CHECK ("sequenceValue" >= 1),
    ADD CONSTRAINT hospitality_issued_adjustment_notes_number_sequence_identity_check
    CHECK (
        "documentNumber" = (
            'AU-ADJ-' || LPAD(
                "sequenceValue"::text,
                GREATEST(8, LENGTH("sequenceValue"::text)),
                '0'
            )
        )
    );

CREATE FUNCTION sf_assert_hospitality_invoice_number_sequence_integrity(
    p_organization_id uuid,
    p_jurisdiction_code varchar,
    p_document_type varchar
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    current_next_value bigint;
    issued_count bigint;
    minimum_value bigint;
    maximum_value bigint;
    sequence_exists boolean;
BEGIN
    IF p_document_type NOT IN ('TAX_INVOICE', 'ADJUSTMENT_NOTE') THEN
        RETURN;
    END IF;

    SELECT number_sequence."nextValue"
      INTO current_next_value
      FROM "hospitality_invoice_number_sequences" number_sequence
     WHERE number_sequence."organizationId" = p_organization_id
       AND number_sequence."jurisdictionCode" = p_jurisdiction_code
       AND number_sequence."documentType" = p_document_type;
    sequence_exists := FOUND;

    IF p_document_type = 'TAX_INVOICE' THEN
        SELECT COUNT(*)::bigint,
               MIN(invoice."sequenceValue"),
               MAX(invoice."sequenceValue")
          INTO issued_count, minimum_value, maximum_value
          FROM "hospitality_issued_invoices" invoice
         WHERE invoice."organizationId" = p_organization_id
           AND invoice."jurisdictionCode" = p_jurisdiction_code
           AND invoice."documentType" = p_document_type;
    ELSE
        SELECT COUNT(*)::bigint,
               MIN(note."sequenceValue"),
               MAX(note."sequenceValue")
          INTO issued_count, minimum_value, maximum_value
          FROM "hospitality_issued_adjustment_notes" note
         WHERE note."organizationId" = p_organization_id
           AND note."jurisdictionCode" = p_jurisdiction_code
           AND note."documentType" = p_document_type;
    END IF;

    IF issued_count = 0 THEN
        IF sequence_exists AND current_next_value <> 1 THEN
            RAISE EXCEPTION 'hospitality invoice number sequence does not match issued legal-document history'
                USING ERRCODE = '23514';
        END IF;
        RETURN;
    END IF;

    IF NOT sequence_exists THEN
        RAISE EXCEPTION 'issued hospitality legal document is missing its invoice number sequence'
            USING ERRCODE = '23514';
    END IF;

    IF minimum_value <> 1
       OR maximum_value <> issued_count
       OR current_next_value <> maximum_value + 1 THEN
        RAISE EXCEPTION 'hospitality invoice number sequence does not match issued legal-document history'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_guard_hospitality_invoice_number_sequence_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."jurisdictionCode" IS DISTINCT FROM OLD."jurisdictionCode"
       OR NEW."documentType" IS DISTINCT FROM OLD."documentType" THEN
        RAISE EXCEPTION 'hospitality invoice number sequence identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."nextValue" IS DISTINCT FROM OLD."nextValue" + 1 THEN
        RAISE EXCEPTION 'hospitality invoice number sequence must advance exactly one value at a time'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_invoice_number_sequence_update_guard
BEFORE UPDATE ON "hospitality_invoice_number_sequences"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_invoice_number_sequence_update();

CREATE FUNCTION sf_check_hospitality_invoice_number_sequence_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sf_assert_hospitality_invoice_number_sequence_integrity(
            OLD."organizationId",
            OLD."jurisdictionCode",
            OLD."documentType"
        );
    ELSE
        PERFORM sf_assert_hospitality_invoice_number_sequence_integrity(
            NEW."organizationId",
            NEW."jurisdictionCode",
            NEW."documentType"
        );
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_invoice_number_sequence_integrity_guard
AFTER INSERT OR UPDATE OR DELETE ON "hospitality_invoice_number_sequences"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_check_hospitality_invoice_number_sequence_row();

CREATE FUNCTION sf_check_hospitality_issued_invoice_number_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sf_assert_hospitality_invoice_number_sequence_integrity(
            OLD."organizationId",
            OLD."jurisdictionCode",
            OLD."documentType"
        );
    ELSE
        PERFORM sf_assert_hospitality_invoice_number_sequence_integrity(
            NEW."organizationId",
            NEW."jurisdictionCode",
            NEW."documentType"
        );
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_issued_invoice_number_sequence_guard
AFTER INSERT OR DELETE ON "hospitality_issued_invoices"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_check_hospitality_issued_invoice_number_sequence();

CREATE CONSTRAINT TRIGGER hospitality_issued_adjustment_note_number_sequence_guard
AFTER INSERT OR DELETE ON "hospitality_issued_adjustment_notes"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_check_hospitality_issued_invoice_number_sequence();
