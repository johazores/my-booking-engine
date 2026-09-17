CREATE TABLE "rental_security_bond_forfeitures" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "bondId" UUID NOT NULL,
    "liabilityDecisionId" UUID NOT NULL,
    "collectionTransactionId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "forfeitedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_security_bond_forfeitures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_security_bond_forfeitures_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_security_bond_forfeitures_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_security_bond_forfeitures_idempotency_check" CHECK ("idempotencyKey" ~ '^rental-bond:forfeiture:[a-f0-9]{48}$')
);

CREATE UNIQUE INDEX "rental_security_bond_forfeitures_id_org_key" ON "rental_security_bond_forfeitures"("id", "organizationId");
CREATE UNIQUE INDEX "rental_security_bond_forfeitures_org_booking_key" ON "rental_security_bond_forfeitures"("organizationId", "bookingId");
CREATE UNIQUE INDEX "rental_security_bond_forfeitures_org_bond_key" ON "rental_security_bond_forfeitures"("organizationId", "bondId");
CREATE UNIQUE INDEX "rental_security_bond_forfeitures_org_liability_key" ON "rental_security_bond_forfeitures"("organizationId", "liabilityDecisionId");
CREATE UNIQUE INDEX "rental_security_bond_forfeitures_org_collection_key" ON "rental_security_bond_forfeitures"("organizationId", "collectionTransactionId");
CREATE UNIQUE INDEX "rental_security_bond_forfeitures_org_idempotency_key" ON "rental_security_bond_forfeitures"("organizationId", "idempotencyKey");
CREATE INDEX "rental_security_bond_forfeitures_org_created_idx" ON "rental_security_bond_forfeitures"("organizationId", "createdAt");

ALTER TABLE "rental_security_bond_forfeitures" ADD CONSTRAINT "rental_security_bond_forfeitures_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId") REFERENCES "rental_bookings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rental_security_bond_forfeitures" ADD CONSTRAINT "rental_security_bond_forfeitures_bond_fkey"
FOREIGN KEY ("bondId", "organizationId") REFERENCES "rental_security_bond_requirements"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rental_security_bond_forfeitures" ADD CONSTRAINT "rental_security_bond_forfeitures_liability_fkey"
FOREIGN KEY ("liabilityDecisionId", "organizationId") REFERENCES "rental_damage_liability_decisions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rental_security_bond_forfeitures" ADD CONSTRAINT "rental_security_bond_forfeitures_collection_fkey"
FOREIGN KEY ("collectionTransactionId", "organizationId") REFERENCES "rental_security_bond_transactions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_security_bond_forfeiture()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    bond_booking_id UUID;
    bond_currency CHAR(3);
    bond_amount BIGINT;
    collection_created_at TIMESTAMPTZ;
    liability_currency CHAR(3);
    liability_amount BIGINT;
    liability_unit_id UUID;
    liability_decided_at TIMESTAMPTZ;
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental security bond forfeitures are append-only' USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('sf:rental-security-bond-disposition:' || NEW."organizationId"::text || ':' || NEW."bondId"::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('sf:rental-damage-liability-settlement:' || NEW."organizationId"::text || ':' || NEW."liabilityDecisionId"::text, 0));

    SELECT bond."bookingId", bond."currency", bond."amountMinor"
      INTO bond_booking_id, bond_currency, bond_amount
      FROM "rental_security_bond_requirements" bond
     WHERE bond."organizationId" = NEW."organizationId"
       AND bond."id" = NEW."bondId"
       AND bond."bookingId" = NEW."bookingId";
    IF bond_booking_id IS NULL OR NEW."currency" <> bond_currency OR NEW."amountMinor" <> bond_amount THEN
        RAISE EXCEPTION 'rental security bond forfeiture must match the retained bond requirement exactly' USING ERRCODE = '23514';
    END IF;

    SELECT collection."createdAt"
      INTO collection_created_at
      FROM "rental_security_bond_transactions" collection
     WHERE collection."organizationId" = NEW."organizationId"
       AND collection."id" = NEW."collectionTransactionId"
       AND collection."bookingId" = NEW."bookingId"
       AND collection."bondId" = NEW."bondId"
       AND collection."kind" = 'OFFLINE_PAYMENT'
       AND collection."status" = 'SUCCEEDED'
       AND collection."providerCode" = 'manual'
       AND collection."currency" = NEW."currency"
       AND collection."amountMinor" = NEW."amountMinor";
    IF collection_created_at IS NULL THEN
        RAISE EXCEPTION 'rental security bond forfeiture requires matching retained collection evidence' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "rental_security_bond_transactions" release
         WHERE release."organizationId" = NEW."organizationId" AND release."bondId" = NEW."bondId"
           AND release."kind" = 'REFUND' AND release."status" = 'SUCCEEDED'
    ) THEN
        RAISE EXCEPTION 'released rental security bond cannot be forfeited' USING ERRCODE = '23514';
    END IF;

    SELECT liability."currency", liability."liableAmountMinor", liability."unitId", liability."decidedAt"
      INTO liability_currency, liability_amount, liability_unit_id, liability_decided_at
      FROM "rental_damage_liability_decisions" liability
     WHERE liability."organizationId" = NEW."organizationId"
       AND liability."id" = NEW."liabilityDecisionId"
       AND liability."bookingId" = NEW."bookingId"
       AND liability."outcome" = 'CUSTOMER_LIABLE';
    IF liability_amount IS NULL OR liability_amount <= 0 OR NEW."currency" <> liability_currency OR NEW."amountMinor" <> liability_amount THEN
        RAISE EXCEPTION 'rental security bond forfeiture requires exact full-value customer damage liability authority' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "rental_booking_fulfillment_events" event
         WHERE event."organizationId" = NEW."organizationId" AND event."bookingId" = NEW."bookingId"
           AND event."unitId" = liability_unit_id AND event."kind" = 'RETURNED'
    ) THEN
        RAISE EXCEPTION 'rental security bond forfeiture requires retained return custody evidence' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "rental_damage_settlement_transactions" settlement
         WHERE settlement."organizationId" = NEW."organizationId" AND settlement."liabilityDecisionId" = NEW."liabilityDecisionId"
    ) THEN
        RAISE EXCEPTION 'customer damage liability already has separate settlement evidence' USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();
    IF authored_at < collection_created_at OR authored_at < liability_decided_at THEN
        RAISE EXCEPTION 'rental security bond forfeiture chronology cannot predate its retained authority' USING ERRCODE = '23514';
    END IF;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_security_bond_forfeitures_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_security_bond_forfeitures"
FOR EACH ROW EXECUTE FUNCTION sf_author_rental_security_bond_forfeiture();

CREATE FUNCTION sf_guard_rental_security_bond_release_after_forfeiture()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."kind" <> 'REFUND' THEN RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('sf:rental-security-bond-disposition:' || NEW."organizationId"::text || ':' || NEW."bondId"::text, 0));
    IF EXISTS (
        SELECT 1 FROM "rental_security_bond_forfeitures" forfeiture
         WHERE forfeiture."organizationId" = NEW."organizationId" AND forfeiture."bondId" = NEW."bondId"
    ) THEN
        RAISE EXCEPTION 'forfeited rental security bond cannot also be released' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_security_bond_transactions_forfeiture_guard
BEFORE INSERT ON "rental_security_bond_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_security_bond_release_after_forfeiture();

CREATE FUNCTION sf_guard_rental_damage_settlement_against_bond_forfeiture()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('sf:rental-damage-liability-settlement:' || NEW."organizationId"::text || ':' || NEW."liabilityDecisionId"::text, 0));
    IF EXISTS (
        SELECT 1 FROM "rental_security_bond_forfeitures" forfeiture
         WHERE forfeiture."organizationId" = NEW."organizationId" AND forfeiture."liabilityDecisionId" = NEW."liabilityDecisionId"
    ) THEN
        RAISE EXCEPTION 'customer damage liability is already settled by security bond forfeiture' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER rental_damage_settlement_transactions_bond_forfeiture_guard
BEFORE INSERT ON "rental_damage_settlement_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_damage_settlement_against_bond_forfeiture();

CREATE OR REPLACE FUNCTION sf_guard_rental_security_bond_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."status" <> 'CANCELLED' OR OLD."status" = 'CANCELLED' THEN RETURN NEW; END IF;
    IF EXISTS (
        SELECT 1 FROM "rental_security_bond_requirements" bond
        JOIN "rental_security_bond_transactions" collection
          ON collection."organizationId" = bond."organizationId" AND collection."bondId" = bond."id"
         AND collection."kind" = 'OFFLINE_PAYMENT' AND collection."status" = 'SUCCEEDED'
        WHERE bond."organizationId" = NEW."organizationId" AND bond."bookingId" = NEW."id"
          AND NOT EXISTS (
              SELECT 1 FROM "rental_security_bond_transactions" release
               WHERE release."organizationId" = bond."organizationId" AND release."bondId" = bond."id"
                 AND release."kind" = 'REFUND' AND release."status" = 'SUCCEEDED'
          )
          AND NOT EXISTS (
              SELECT 1 FROM "rental_security_bond_forfeitures" forfeiture
               WHERE forfeiture."organizationId" = bond."organizationId" AND forfeiture."bondId" = bond."id"
          )
    ) THEN
        RAISE EXCEPTION 'release or explicitly forfeit the collected rental security bond before cancelling this booking' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;
