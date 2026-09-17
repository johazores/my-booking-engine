CREATE TABLE "rental_damage_settlement_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "damageCaseId" UUID NOT NULL,
    "liabilityDecisionId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "kind" "PaymentTransactionKind" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "sourceProviderReference" VARCHAR(160),
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_damage_settlement_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_damage_settlement_transactions_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_damage_settlement_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_damage_settlement_transactions_request_fingerprint_check" CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "rental_damage_settlement_transactions_provider_check" CHECK (btrim("providerCode") <> '' AND btrim("providerReference") <> '')
);

CREATE UNIQUE INDEX "rental_damage_settlement_transactions_id_org_key"
ON "rental_damage_settlement_transactions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_damage_settlement_transactions_org_idempotency_key"
ON "rental_damage_settlement_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "rental_damage_settlement_transactions_org_provider_reference_key"
ON "rental_damage_settlement_transactions"("organizationId", "providerCode", "providerReference");
CREATE UNIQUE INDEX "rental_damage_settlement_transactions_org_liability_kind_key"
ON "rental_damage_settlement_transactions"("organizationId", "liabilityDecisionId", "kind");
CREATE INDEX "rental_damage_settlement_transactions_booking_created_idx"
ON "rental_damage_settlement_transactions"("organizationId", "bookingId", "createdAt");
CREATE INDEX "rental_damage_settlement_transactions_case_created_idx"
ON "rental_damage_settlement_transactions"("organizationId", "damageCaseId", "createdAt");

ALTER TABLE "rental_damage_settlement_transactions"
ADD CONSTRAINT "rental_damage_settlement_transactions_liability_fkey"
FOREIGN KEY ("liabilityDecisionId", "organizationId")
REFERENCES "rental_damage_liability_decisions"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_damage_settlement_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
    liability_booking_id UUID;
    liability_case_id UUID;
    liability_currency CHAR(3);
    liability_amount BIGINT;
    source_created_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental damage settlement transactions are append-only'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" <> 'SUCCEEDED'
       OR NEW."providerCode" <> 'manual'
       OR NEW."kind" NOT IN ('OFFLINE_PAYMENT', 'REFUND') THEN
        RAISE EXCEPTION 'rental damage settlement only accepts successful manual payment/refund evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'OFFLINE_PAYMENT' THEN
        IF NEW."idempotencyKey" !~ '^rental-damage:manual-payment:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental damage payment idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;
        IF NEW."sourceProviderReference" IS NOT NULL THEN
            RAISE EXCEPTION 'rental damage payment cannot reference a refund source'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW."idempotencyKey" !~ '^rental-damage:manual-refund:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental damage refund idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;
        IF NEW."sourceProviderReference" IS NULL
           OR btrim(NEW."sourceProviderReference") = ''
           OR NEW."sourceProviderReference" = NEW."providerReference" THEN
            RAISE EXCEPTION 'rental damage refund requires a distinct retained payment source'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT liability."bookingId", liability."damageCaseId", liability."currency", liability."liableAmountMinor"
      INTO liability_booking_id, liability_case_id, liability_currency, liability_amount
      FROM "rental_damage_liability_decisions" liability
     WHERE liability."organizationId" = NEW."organizationId"
       AND liability."id" = NEW."liabilityDecisionId"
       AND liability."bookingId" = NEW."bookingId"
       AND liability."damageCaseId" = NEW."damageCaseId"
       AND liability."outcome" = 'CUSTOMER_LIABLE';

    IF liability_booking_id IS NULL
       OR liability_case_id IS NULL
       OR liability_amount IS NULL
       OR liability_amount <= 0
       OR NEW."currency" <> liability_currency
       OR NEW."amountMinor" <> liability_amount THEN
        RAISE EXCEPTION 'rental damage settlement must match retained customer liability authority exactly'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'REFUND' THEN
        SELECT source."createdAt"
          INTO source_created_at
          FROM "rental_damage_settlement_transactions" source
         WHERE source."organizationId" = NEW."organizationId"
           AND source."liabilityDecisionId" = NEW."liabilityDecisionId"
           AND source."bookingId" = NEW."bookingId"
           AND source."damageCaseId" = NEW."damageCaseId"
           AND source."kind" = 'OFFLINE_PAYMENT'
           AND source."status" = 'SUCCEEDED'
           AND source."providerCode" = 'manual'
           AND source."providerReference" = NEW."sourceProviderReference"
           AND source."currency" = NEW."currency"
           AND source."amountMinor" = NEW."amountMinor";

        IF source_created_at IS NULL THEN
            RAISE EXCEPTION 'rental damage refund requires matching retained payment evidence'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    authored_at := clock_timestamp();
    IF source_created_at IS NOT NULL AND authored_at < source_created_at THEN
        RAISE EXCEPTION 'rental damage refund chronology cannot predate its payment source'
            USING ERRCODE = '23514';
    END IF;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_damage_settlement_transactions_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_damage_settlement_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_damage_settlement_transaction();
