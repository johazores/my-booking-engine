CREATE TABLE "rental_security_bond_requirements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_security_bond_requirements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_security_bond_requirements_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_security_bond_requirements_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "rental_security_bond_requirements_id_org_key" ON "rental_security_bond_requirements"("id", "organizationId");
CREATE UNIQUE INDEX "rental_security_bond_requirements_org_booking_key" ON "rental_security_bond_requirements"("organizationId", "bookingId");
CREATE UNIQUE INDEX "rental_security_bond_requirements_org_idempotency_key" ON "rental_security_bond_requirements"("organizationId", "idempotencyKey");
CREATE INDEX "rental_security_bond_requirements_org_created_idx" ON "rental_security_bond_requirements"("organizationId", "createdAt");

CREATE TABLE "rental_security_bond_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "bondId" UUID NOT NULL,
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
    CONSTRAINT "rental_security_bond_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_security_bond_transactions_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_security_bond_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_security_bond_transactions_fingerprint_check" CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "rental_security_bond_transactions_provider_check" CHECK (btrim("providerCode") <> '' AND btrim("providerReference") <> '')
);

CREATE UNIQUE INDEX "rental_security_bond_transactions_id_org_key" ON "rental_security_bond_transactions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_security_bond_transactions_org_idempotency_key" ON "rental_security_bond_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "rental_security_bond_transactions_org_provider_reference_key" ON "rental_security_bond_transactions"("organizationId", "providerCode", "providerReference");
CREATE UNIQUE INDEX "rental_security_bond_transactions_org_bond_kind_key" ON "rental_security_bond_transactions"("organizationId", "bondId", "kind");
CREATE INDEX "rental_security_bond_transactions_booking_created_idx" ON "rental_security_bond_transactions"("organizationId", "bookingId", "createdAt");
ALTER TABLE "rental_security_bond_transactions" ADD CONSTRAINT "rental_security_bond_transactions_bond_fkey" FOREIGN KEY ("bondId", "organizationId") REFERENCES "rental_security_bond_requirements"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_security_bond_requirement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE booking_currency CHAR(3); booking_status "BookingStatus"; booking_cancelled_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'rental security bond requirements are append-only' USING ERRCODE = '23514'; END IF;
    IF NEW."idempotencyKey" !~ '^rental-bond:requirement:[a-f0-9]{48}$' THEN RAISE EXCEPTION 'rental security bond requirement idempotency evidence is invalid' USING ERRCODE = '23514'; END IF;
    SELECT booking."currency", booking."status", booking."cancelledAt" INTO booking_currency, booking_status, booking_cancelled_at
      FROM "rental_bookings" booking WHERE booking."organizationId" = NEW."organizationId" AND booking."id" = NEW."bookingId";
    IF booking_currency IS NULL OR booking_status <> 'CONFIRMED' OR booking_cancelled_at IS NOT NULL OR NEW."currency" <> booking_currency THEN
        RAISE EXCEPTION 'rental security bond requirement must match a confirmed tenant booking and currency' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "rental_booking_fulfillment_events" event WHERE event."organizationId" = NEW."organizationId" AND event."bookingId" = NEW."bookingId") THEN
        RAISE EXCEPTION 'rental security bond requirement must be established before physical custody begins' USING ERRCODE = '23514';
    END IF;
    NEW."createdAt" := clock_timestamp();
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_security_bond_requirements_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON "rental_security_bond_requirements" FOR EACH ROW EXECUTE FUNCTION sf_author_rental_security_bond_requirement();

CREATE FUNCTION sf_author_rental_security_bond_transaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bond_booking_id UUID; bond_currency CHAR(3); bond_amount BIGINT; source_created_at TIMESTAMPTZ; authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'rental security bond transactions are append-only' USING ERRCODE = '23514'; END IF;
    IF NEW."status" <> 'SUCCEEDED' OR NEW."providerCode" <> 'manual' OR NEW."kind" NOT IN ('OFFLINE_PAYMENT', 'REFUND') THEN
        RAISE EXCEPTION 'rental security bond only accepts successful manual collection/release evidence' USING ERRCODE = '23514';
    END IF;
    IF NEW."kind" = 'OFFLINE_PAYMENT' THEN
        IF NEW."idempotencyKey" !~ '^rental-bond:manual-collection:[a-f0-9]{48}$' OR NEW."sourceProviderReference" IS NOT NULL THEN
            RAISE EXCEPTION 'rental security bond collection evidence is invalid' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW."idempotencyKey" !~ '^rental-bond:manual-release:[a-f0-9]{48}$' OR NEW."sourceProviderReference" IS NULL OR btrim(NEW."sourceProviderReference") = '' OR NEW."sourceProviderReference" = NEW."providerReference" THEN
            RAISE EXCEPTION 'rental security bond release requires a distinct retained collection source' USING ERRCODE = '23514';
        END IF;
    END IF;
    SELECT bond."bookingId", bond."currency", bond."amountMinor" INTO bond_booking_id, bond_currency, bond_amount
      FROM "rental_security_bond_requirements" bond
     WHERE bond."organizationId" = NEW."organizationId" AND bond."id" = NEW."bondId" AND bond."bookingId" = NEW."bookingId";
    IF bond_booking_id IS NULL OR NEW."currency" <> bond_currency OR NEW."amountMinor" <> bond_amount THEN
        RAISE EXCEPTION 'rental security bond transaction must match retained requirement exactly' USING ERRCODE = '23514';
    END IF;
    IF NEW."kind" = 'OFFLINE_PAYMENT' AND EXISTS (SELECT 1 FROM "rental_booking_fulfillment_events" event WHERE event."organizationId" = NEW."organizationId" AND event."bookingId" = NEW."bookingId") THEN
        RAISE EXCEPTION 'rental security bond collection must be recorded before physical custody begins' USING ERRCODE = '23514';
    END IF;
    IF NEW."kind" = 'REFUND' THEN
        SELECT source."createdAt" INTO source_created_at FROM "rental_security_bond_transactions" source
         WHERE source."organizationId" = NEW."organizationId" AND source."bondId" = NEW."bondId" AND source."bookingId" = NEW."bookingId"
           AND source."kind" = 'OFFLINE_PAYMENT' AND source."status" = 'SUCCEEDED' AND source."providerCode" = 'manual'
           AND source."providerReference" = NEW."sourceProviderReference" AND source."currency" = NEW."currency" AND source."amountMinor" = NEW."amountMinor";
        IF source_created_at IS NULL THEN RAISE EXCEPTION 'rental security bond release requires matching retained collection evidence' USING ERRCODE = '23514'; END IF;
    END IF;
    authored_at := clock_timestamp();
    IF source_created_at IS NOT NULL AND authored_at < source_created_at THEN RAISE EXCEPTION 'rental security bond release chronology cannot predate collection' USING ERRCODE = '23514'; END IF;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_security_bond_transactions_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON "rental_security_bond_transactions" FOR EACH ROW EXECUTE FUNCTION sf_author_rental_security_bond_transaction();

CREATE OR REPLACE FUNCTION sf_guard_rental_manual_reference_cross_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."providerCode" <> 'manual' THEN RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sf:rental-manual-reference:' || NEW."organizationId"::text || ':' || NEW."providerReference", 0));
    IF TG_TABLE_NAME <> 'rental_payment_transactions' AND EXISTS (SELECT 1 FROM "rental_payment_transactions" row WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference") THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as booking settlement evidence in this tenant' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME <> 'rental_damage_settlement_transactions' AND EXISTS (SELECT 1 FROM "rental_damage_settlement_transactions" row WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference") THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as damage settlement evidence in this tenant' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME <> 'rental_security_bond_transactions' AND EXISTS (SELECT 1 FROM "rental_security_bond_transactions" row WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference") THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as security bond evidence in this tenant' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME NOT IN ('rental_payment_transactions', 'rental_damage_settlement_transactions', 'rental_security_bond_transactions') THEN
        RAISE EXCEPTION 'manual rental provider reference guard is attached to an unexpected table' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_security_bond_transactions_cross_scope_reference_guard BEFORE INSERT ON "rental_security_bond_transactions" FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

CREATE FUNCTION sf_guard_rental_security_bond_pickup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bond_id UUID; bond_amount BIGINT; bond_currency CHAR(3);
BEGIN
    IF NEW."kind" <> 'PICKED_UP' THEN RETURN NEW; END IF;
    SELECT bond."id", bond."amountMinor", bond."currency" INTO bond_id, bond_amount, bond_currency FROM "rental_security_bond_requirements" bond
      WHERE bond."organizationId" = NEW."organizationId" AND bond."bookingId" = NEW."bookingId";
    IF bond_id IS NULL THEN RETURN NEW; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "rental_security_bond_transactions" collection
         WHERE collection."organizationId" = NEW."organizationId" AND collection."bookingId" = NEW."bookingId" AND collection."bondId" = bond_id
           AND collection."kind" = 'OFFLINE_PAYMENT' AND collection."status" = 'SUCCEEDED' AND collection."providerCode" = 'manual'
           AND collection."currency" = bond_currency AND collection."amountMinor" = bond_amount
    ) OR EXISTS (
        SELECT 1 FROM "rental_security_bond_transactions" release
         WHERE release."organizationId" = NEW."organizationId" AND release."bookingId" = NEW."bookingId" AND release."bondId" = bond_id
           AND release."kind" = 'REFUND' AND release."status" = 'SUCCEEDED'
    ) THEN
        RAISE EXCEPTION 'rental pickup requires the retained security bond to be actively collected' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_fulfillment_security_bond_pickup_guard BEFORE INSERT ON "rental_booking_fulfillment_events" FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_security_bond_pickup();

CREATE FUNCTION sf_guard_rental_security_bond_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."status" <> 'CANCELLED' OR OLD."status" = 'CANCELLED' THEN RETURN NEW; END IF;
    IF EXISTS (
        SELECT 1 FROM "rental_security_bond_requirements" bond
        JOIN "rental_security_bond_transactions" collection ON collection."organizationId" = bond."organizationId" AND collection."bondId" = bond."id" AND collection."kind" = 'OFFLINE_PAYMENT' AND collection."status" = 'SUCCEEDED'
        WHERE bond."organizationId" = NEW."organizationId" AND bond."bookingId" = NEW."id"
          AND NOT EXISTS (SELECT 1 FROM "rental_security_bond_transactions" release WHERE release."organizationId" = bond."organizationId" AND release."bondId" = bond."id" AND release."kind" = 'REFUND' AND release."status" = 'SUCCEEDED')
    ) THEN
        RAISE EXCEPTION 'release the collected rental security bond before cancelling this booking' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_booking_security_bond_cancellation_guard BEFORE UPDATE OF "status" ON "rental_bookings" FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_security_bond_cancellation();
