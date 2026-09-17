CREATE TYPE "RentalDamageLiabilityOutcome" AS ENUM ('CUSTOMER_LIABLE', 'NO_CUSTOMER_LIABILITY');

CREATE TABLE "rental_damage_liability_decisions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "damageCaseId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(140) NOT NULL,
    "outcome" "RentalDamageLiabilityOutcome" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "liableAmountMinor" BIGINT,
    "reason" VARCHAR(2000) NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_damage_liability_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_damage_liability_decisions_idempotency_check" CHECK (
        "idempotencyKey" = ('rental-damage-liability:' || "damageCaseId"::text)
    ),
    CONSTRAINT "rental_damage_liability_decisions_currency_check" CHECK (
        "currency" ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT "rental_damage_liability_decisions_reason_check" CHECK (
        btrim("reason") <> ''
    ),
    CONSTRAINT "rental_damage_liability_decisions_amount_check" CHECK (
        ("outcome" = 'CUSTOMER_LIABLE' AND "liableAmountMinor" IS NOT NULL AND "liableAmountMinor" > 0)
        OR
        ("outcome" = 'NO_CUSTOMER_LIABILITY' AND "liableAmountMinor" IS NULL)
    )
);

CREATE UNIQUE INDEX "rental_damage_liability_decisions_id_org_key"
ON "rental_damage_liability_decisions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_damage_liability_decisions_org_booking_key"
ON "rental_damage_liability_decisions"("organizationId", "bookingId");
CREATE UNIQUE INDEX "rental_damage_liability_decisions_org_case_key"
ON "rental_damage_liability_decisions"("organizationId", "damageCaseId");
CREATE UNIQUE INDEX "rental_damage_liability_decisions_org_idempotency_key"
ON "rental_damage_liability_decisions"("organizationId", "idempotencyKey");
CREATE INDEX "rental_damage_liability_decisions_org_outcome_decided_idx"
ON "rental_damage_liability_decisions"("organizationId", "outcome", "decidedAt");

ALTER TABLE "rental_damage_liability_decisions"
ADD CONSTRAINT "rental_damage_liability_decisions_damage_case_fkey"
FOREIGN KEY ("damageCaseId", "organizationId")
REFERENCES "rental_damage_cases"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_damage_liability_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
    case_status "RentalDamageCaseStatus";
    case_currency CHAR(3);
    case_estimate BIGINT;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental damage liability decisions are append-only'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."idempotencyKey" <> ('rental-damage-liability:' || NEW."damageCaseId"::text) THEN
        RAISE EXCEPTION 'rental damage liability idempotency evidence is invalid'
            USING ERRCODE = '23514';
    END IF;

    SELECT damage_case."status", damage_case."currency", damage_case."estimatedRepairCostMinor"
      INTO case_status, case_currency, case_estimate
      FROM "rental_damage_cases" damage_case
      JOIN "rental_bookings" booking
        ON booking."organizationId" = damage_case."organizationId"
       AND booking."id" = damage_case."bookingId"
     WHERE damage_case."organizationId" = NEW."organizationId"
       AND damage_case."id" = NEW."damageCaseId"
       AND damage_case."bookingId" = NEW."bookingId"
       AND damage_case."unitId" = NEW."unitId"
       AND booking."status" = 'CONFIRMED'
       AND booking."currency" = damage_case."currency";

    IF case_status IS NULL
       OR case_status <> 'CLOSED'
       OR case_estimate IS NULL THEN
        RAISE EXCEPTION 'rental damage liability requires assessed retained damage authority'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."currency" <> case_currency THEN
        RAISE EXCEPTION 'rental damage liability currency must match retained damage authority'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."outcome" = 'CUSTOMER_LIABLE' THEN
        IF NEW."liableAmountMinor" IS NULL
           OR NEW."liableAmountMinor" <= 0
           OR NEW."liableAmountMinor" > case_estimate THEN
            RAISE EXCEPTION 'customer damage liability must be positive and cannot exceed retained repair estimate'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."outcome" = 'NO_CUSTOMER_LIABILITY' THEN
        IF NEW."liableAmountMinor" IS NOT NULL THEN
            RAISE EXCEPTION 'no-liability decision cannot retain a customer amount'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'rental damage liability outcome is invalid'
            USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();
    NEW."decidedAt" := authored_at;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_damage_liability_decisions_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_damage_liability_decisions"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_damage_liability_decision();
