-- Keep retained Australian legal-document chronology consistent at the PostgreSQL boundary.
-- Application writers already validate these relationships. These checks prevent direct SQL/ORM
-- writes from persisting a row timestamp that disagrees with its immutable legal snapshot or an
-- adjustment-note chronology that the domain parser would later reject.

CREATE OR REPLACE FUNCTION sf_hospitality_legal_snapshot_time_valid(
    snapshot JSONB,
    row_issued_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    issued_at_text TEXT;
    issued_at_value TIMESTAMPTZ;
BEGIN
    IF snapshot IS NULL OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object' OR row_issued_at IS NULL THEN
        RETURN FALSE;
    END IF;

    issued_at_text := snapshot->>'issuedAt';
    IF issued_at_text IS NULL
       OR issued_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
        RETURN FALSE;
    END IF;

    BEGIN
        issued_at_value := issued_at_text::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
    END;

    RETURN issued_at_value IS NOT DISTINCT FROM row_issued_at;
END;
$$;

CREATE OR REPLACE FUNCTION sf_hospitality_adjustment_chronology_valid(
    snapshot JSONB,
    row_issued_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    schema_version TEXT;
    adjustment_reason TEXT;
    source_issued_at_text TEXT;
    source_issued_at_value TIMESTAMPTZ;
    amendment_applied_at_text TEXT;
    amendment_applied_at_value TIMESTAMPTZ;
    predecessor_issued_at_text TEXT;
    predecessor_issued_at_value TIMESTAMPTZ;
BEGIN
    IF NOT sf_hospitality_legal_snapshot_time_valid(snapshot, row_issued_at) THEN
        RETURN FALSE;
    END IF;

    schema_version := snapshot->>'schemaVersion';
    IF schema_version IS NULL OR schema_version NOT IN ('1', '2', '3', '4', '5', '6') THEN
        RETURN FALSE;
    END IF;

    source_issued_at_text := snapshot->>'sourceInvoiceIssuedAt';
    IF source_issued_at_text IS NULL
       OR source_issued_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
        RETURN FALSE;
    END IF;

    BEGIN
        source_issued_at_value := source_issued_at_text::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
    END;

    IF source_issued_at_value IS NULL OR source_issued_at_value > row_issued_at THEN
        RETURN FALSE;
    END IF;

    adjustment_reason := snapshot->>'adjustmentReason';
    IF schema_version IN ('2', '3', '4', '5') THEN
        IF adjustment_reason IS DISTINCT FROM 'COMMERCIAL_AMENDMENT' THEN
            RETURN FALSE;
        END IF;

        amendment_applied_at_text := snapshot->>'commercialAmendmentAppliedAt';
        IF amendment_applied_at_text IS NULL
           OR amendment_applied_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
            RETURN FALSE;
        END IF;

        BEGIN
            amendment_applied_at_value := amendment_applied_at_text::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RETURN FALSE;
        END;

        IF amendment_applied_at_value IS NULL
           OR amendment_applied_at_value < source_issued_at_value
           OR amendment_applied_at_value > row_issued_at THEN
            RETURN FALSE;
        END IF;
    END IF;

    IF schema_version IN ('3', '5', '6') THEN
        predecessor_issued_at_text := snapshot->>'predecessorAdjustmentIssuedAt';
        IF predecessor_issued_at_text IS NULL
           OR predecessor_issued_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
            RETURN FALSE;
        END IF;

        BEGIN
            predecessor_issued_at_value := predecessor_issued_at_text::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RETURN FALSE;
        END;

        IF predecessor_issued_at_value IS NULL
           OR predecessor_issued_at_value < source_issued_at_value
           OR predecessor_issued_at_value > row_issued_at THEN
            RETURN FALSE;
        END IF;

        IF schema_version IN ('3', '5')
           AND amendment_applied_at_value < predecessor_issued_at_value THEN
            RETURN FALSE;
        END IF;
    END IF;

    IF schema_version = '1' AND adjustment_reason IS DISTINCT FROM 'BOOKING_CANCELLATION' THEN
        RETURN FALSE;
    END IF;
    IF schema_version = '6' AND adjustment_reason IS DISTINCT FROM 'BOOKING_CANCELLATION' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_snapshot_time_check"
  CHECK (
    sf_hospitality_legal_snapshot_time_valid(
      "documentSnapshot",
      "issuedAt"
    )
  ) NOT VALID;

ALTER TABLE "hospitality_issued_adjustment_notes"
  ADD CONSTRAINT "hospitality_adj_notes_snapshot_chronology_check"
  CHECK (
    sf_hospitality_adjustment_chronology_valid(
      "documentSnapshot",
      "issuedAt"
    )
  ) NOT VALID;

-- Retained legal documents must satisfy the same chronology already required by application
-- parsing. Fail deployment rather than silently grandfathering malformed immutable evidence.
ALTER TABLE "hospitality_issued_invoices"
  VALIDATE CONSTRAINT "hospitality_issued_invoices_snapshot_time_check";

ALTER TABLE "hospitality_issued_adjustment_notes"
  VALIDATE CONSTRAINT "hospitality_adj_notes_snapshot_chronology_check";
