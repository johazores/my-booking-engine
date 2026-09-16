CREATE OR REPLACE FUNCTION sf_guard_rental_payment_request_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."requestFingerprint" IS NULL
       OR NEW."requestFingerprint" !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'rental payment request fingerprint is required for new settlement evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'OFFLINE_PAYMENT' THEN
        IF NEW."idempotencyKey" !~ '^rental:manual-payment:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental offline payment idempotency key does not match the enabled operation contract'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."kind" = 'REFUND' THEN
        IF NEW."idempotencyKey" !~ '^rental:manual-refund:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental refund idempotency key does not match the enabled operation contract'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Settlement chronology is commercial evidence. Always replace any caller-
    -- supplied/default transaction-start timestamp with the database wall clock
    -- at the actual insert boundary.
    NEW."createdAt" := clock_timestamp();

    RETURN NEW;
END;
$$;
