CREATE FUNCTION sf_guard_rental_payment_request_evidence()
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

    IF NEW."createdAt" IS DISTINCT FROM CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'rental payment creation time must be database-authored'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_payment_transactions_authority_guard
BEFORE INSERT ON "rental_payment_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_payment_request_evidence();
