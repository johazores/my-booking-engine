CREATE TABLE "rental_late_return_settlement_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
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

    CONSTRAINT "rental_late_return_settlement_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_late_return_settlement_transactions_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_late_return_settlement_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_late_return_settlement_transactions_fingerprint_check" CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "rental_late_return_settlement_transactions_provider_check" CHECK (btrim("providerCode") <> '' AND btrim("providerReference") <> '')
);

CREATE UNIQUE INDEX "rental_late_return_settlement_transactions_id_org_key"
ON "rental_late_return_settlement_transactions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_late_return_settlement_transactions_org_idempotency_key"
ON "rental_late_return_settlement_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "rental_late_return_settlement_transactions_org_provider_reference_key"
ON "rental_late_return_settlement_transactions"("organizationId", "providerCode", "providerReference");
CREATE UNIQUE INDEX "rental_late_return_settlement_transactions_org_assessment_kind_key"
ON "rental_late_return_settlement_transactions"("organizationId", "assessmentId", "kind");
CREATE INDEX "rental_late_return_settlement_transactions_booking_created_idx"
ON "rental_late_return_settlement_transactions"("organizationId", "bookingId", "createdAt");

ALTER TABLE "rental_late_return_settlement_transactions"
ADD CONSTRAINT "rental_late_return_settlement_transactions_assessment_fkey"
FOREIGN KEY ("assessmentId", "organizationId")
REFERENCES "rental_late_return_assessments"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_late_return_settlement_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
    assessment_booking_id UUID;
    assessment_currency CHAR(3);
    assessment_fee BIGINT;
    source_created_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental late-return settlement transactions are append-only'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
        0
    ));

    IF NEW."status" <> 'SUCCEEDED'
       OR NEW."providerCode" <> 'manual'
       OR NEW."kind" NOT IN ('OFFLINE_PAYMENT', 'REFUND') THEN
        RAISE EXCEPTION 'rental late-return settlement only accepts successful manual payment/refund evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'OFFLINE_PAYMENT' THEN
        IF NEW."idempotencyKey" !~ '^rental-late-return:manual-payment:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental late-return payment idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;
        IF NEW."sourceProviderReference" IS NOT NULL THEN
            RAISE EXCEPTION 'rental late-return payment cannot reference a refund source'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW."idempotencyKey" !~ '^rental-late-return:manual-refund:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental late-return refund idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;
        IF NEW."sourceProviderReference" IS NULL
           OR btrim(NEW."sourceProviderReference") = ''
           OR NEW."sourceProviderReference" = NEW."providerReference" THEN
            RAISE EXCEPTION 'rental late-return refund requires a distinct retained payment source'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT assessment."bookingId", assessment."currency", assessment."feeMinor"
      INTO assessment_booking_id, assessment_currency, assessment_fee
      FROM "rental_late_return_assessments" assessment
     WHERE assessment."organizationId" = NEW."organizationId"
       AND assessment."id" = NEW."assessmentId"
       AND assessment."bookingId" = NEW."bookingId"
       AND assessment."outcome" = 'FEE_ASSESSED';

    IF assessment_booking_id IS NULL
       OR assessment_fee IS NULL
       OR assessment_fee <= 0
       OR NEW."currency" <> assessment_currency
       OR NEW."amountMinor" <> assessment_fee THEN
        RAISE EXCEPTION 'rental late-return settlement must match retained fee assessment authority exactly'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'REFUND' THEN
        SELECT source."createdAt"
          INTO source_created_at
          FROM "rental_late_return_settlement_transactions" source
         WHERE source."organizationId" = NEW."organizationId"
           AND source."assessmentId" = NEW."assessmentId"
           AND source."bookingId" = NEW."bookingId"
           AND source."kind" = 'OFFLINE_PAYMENT'
           AND source."status" = 'SUCCEEDED'
           AND source."providerCode" = 'manual'
           AND source."providerReference" = NEW."sourceProviderReference"
           AND source."currency" = NEW."currency"
           AND source."amountMinor" = NEW."amountMinor";
        IF source_created_at IS NULL THEN
            RAISE EXCEPTION 'rental late-return refund requires matching retained payment evidence'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    authored_at := clock_timestamp();
    IF source_created_at IS NOT NULL AND authored_at < source_created_at THEN
        RAISE EXCEPTION 'rental late-return refund chronology cannot predate its payment source'
            USING ERRCODE = '23514';
    END IF;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_late_return_settlement_transactions_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_late_return_settlement_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_late_return_settlement_transaction();

CREATE OR REPLACE FUNCTION sf_guard_rental_manual_reference_cross_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."providerCode" <> 'manual' THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-manual-reference:' || NEW."organizationId"::text || ':' || NEW."providerReference",
            0
        )
    );

    IF TG_TABLE_NAME <> 'rental_payment_transactions' AND EXISTS (
        SELECT 1 FROM "rental_payment_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as booking settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_damage_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_damage_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as damage settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_security_bond_transactions' AND EXISTS (
        SELECT 1 FROM "rental_security_bond_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as security bond evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_late_return_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_late_return_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as late-return settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME NOT IN (
        'rental_payment_transactions',
        'rental_damage_settlement_transactions',
        'rental_security_bond_transactions',
        'rental_late_return_settlement_transactions'
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference guard is attached to an unexpected table'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_late_return_settlement_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_late_return_settlement_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();
