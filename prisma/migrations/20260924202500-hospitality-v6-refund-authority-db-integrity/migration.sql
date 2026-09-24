-- Harden schema-version-6 terminal cancellation refund authority at the database boundary.
-- Application verification remains authoritative for full legal-document reconstruction, but
-- direct SQL/ORM inserts must not be able to persist malformed frozen refund membership.

CREATE OR REPLACE FUNCTION sf_hospitality_v6_refund_authorities_valid(
    snapshot JSONB,
    expected_total_minor BIGINT,
    row_issued_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    authorities JSONB;
    authority JSONB;
    authority_index INTEGER := 0;
    key_count INTEGER;
    refund_id TEXT;
    refund_ordinal_text TEXT;
    amount_text TEXT;
    created_at_text TEXT;
    created_at_value TIMESTAMPTZ;
    predecessor_issued_at_value TIMESTAMPTZ;
    total_minor NUMERIC := 0;
    seen_refund_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- This helper is deliberately narrow. Existing schema versions keep their established
    -- constraints and do not gain inferred authority from a schema-6-specific validator.
    IF snapshot IS NULL OR snapshot->>'schemaVersion' IS DISTINCT FROM '6' THEN
        RETURN TRUE;
    END IF;

    IF expected_total_minor IS NULL OR expected_total_minor <= 0 OR row_issued_at IS NULL THEN
        RETURN FALSE;
    END IF;

    authorities := snapshot->'refundAuthorities';
    IF jsonb_typeof(authorities) IS DISTINCT FROM 'array' THEN
        RETURN FALSE;
    END IF;
    IF jsonb_array_length(authorities) NOT BETWEEN 1 AND 256 THEN
        RETURN FALSE;
    END IF;

    IF snapshot->>'predecessorAdjustmentIssuedAt' IS NULL
       OR snapshot->>'predecessorAdjustmentIssuedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
       OR snapshot->>'issuedAt' IS NULL
       OR snapshot->>'issuedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
        RETURN FALSE;
    END IF;

    BEGIN
        predecessor_issued_at_value := (snapshot->>'predecessorAdjustmentIssuedAt')::TIMESTAMPTZ;
        IF (snapshot->>'issuedAt')::TIMESTAMPTZ IS DISTINCT FROM row_issued_at THEN
            RETURN FALSE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
    END;

    IF predecessor_issued_at_value IS NULL OR predecessor_issued_at_value > row_issued_at THEN
        RETURN FALSE;
    END IF;

    FOR authority IN SELECT value FROM jsonb_array_elements(authorities) LOOP
        authority_index := authority_index + 1;

        IF jsonb_typeof(authority) IS DISTINCT FROM 'object' THEN
            RETURN FALSE;
        END IF;

        SELECT count(*)
          INTO key_count
          FROM jsonb_object_keys(authority) AS authority_key;

        -- Freeze only static legal membership. Mutable provider lifecycle status and provider
        -- references remain outside the immutable document snapshot and are reconciled separately.
        IF key_count <> 4
           OR NOT (authority ? 'refundTransactionId')
           OR NOT (authority ? 'refundOrdinal')
           OR NOT (authority ? 'amountMinor')
           OR NOT (authority ? 'createdAt') THEN
            RETURN FALSE;
        END IF;

        refund_id := authority->>'refundTransactionId';
        refund_ordinal_text := authority->>'refundOrdinal';
        amount_text := authority->>'amountMinor';
        created_at_text := authority->>'createdAt';

        IF refund_id IS NULL
           OR refund_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR refund_id = ANY(seen_refund_ids) THEN
            RETURN FALSE;
        END IF;

        IF refund_ordinal_text IS NULL OR refund_ordinal_text !~ '^[1-9][0-9]*$' THEN
            RETURN FALSE;
        END IF;
        IF refund_ordinal_text::NUMERIC <> authority_index::NUMERIC THEN
            RETURN FALSE;
        END IF;

        IF amount_text IS NULL OR amount_text !~ '^[1-9][0-9]*$' THEN
            RETURN FALSE;
        END IF;

        IF created_at_text IS NULL
           OR created_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
            RETURN FALSE;
        END IF;

        BEGIN
            created_at_value := created_at_text::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RETURN FALSE;
        END;

        IF created_at_value IS NULL
           OR created_at_value <= predecessor_issued_at_value
           OR created_at_value > row_issued_at THEN
            RETURN FALSE;
        END IF;

        total_minor := total_minor + amount_text::NUMERIC;
        seen_refund_ids := array_append(seen_refund_ids, refund_id);
    END LOOP;

    RETURN authority_index = jsonb_array_length(authorities)
       AND total_minor = expected_total_minor::NUMERIC;
END;
$$;

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_v6_refund_authorities_check"
  CHECK (
    sf_hospitality_v6_refund_authorities_valid(
      "documentSnapshot",
      "decreaseTotalMinor",
      "issuedAt"
    )
  ) NOT VALID;

-- Existing schema-version-6 rows were produced through the application validator. Validate them
-- before accepting the migration rather than silently grandfathering malformed legal evidence.
ALTER TABLE "hospitality_issued_adjustment_notes"
  VALIDATE CONSTRAINT "hospitality_adj_notes_v6_refund_authorities_check";
