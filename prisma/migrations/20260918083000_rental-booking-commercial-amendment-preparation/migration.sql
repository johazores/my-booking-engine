CREATE TYPE "RentalBookingCommercialAmendmentStatus" AS ENUM ('PREPARED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "RentalBookingCommercialAmendmentDirection" AS ENUM ('ADDITIONAL_CHARGE', 'REFUND');
CREATE TYPE "RentalBookingCommercialAmendmentMode" AS ENUM ('PRE_PICKUP_RESCHEDULE', 'CUSTODY_EXTENSION');

CREATE TABLE "rental_booking_commercial_amendments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" "RentalBookingCommercialAmendmentStatus" NOT NULL DEFAULT 'PREPARED',
    "direction" "RentalBookingCommercialAmendmentDirection" NOT NULL,
    "mode" "RentalBookingCommercialAmendmentMode" NOT NULL,
    "bookingVersion" TIMESTAMPTZ(6) NOT NULL,
    "unitId" UUID NOT NULL,
    "unitTypeId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "pickupEventId" UUID,
    "sourceStartsOn" DATE NOT NULL,
    "sourceEndsOn" DATE NOT NULL,
    "targetStartsOn" DATE NOT NULL,
    "targetEndsOn" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "beforeTotalMinor" BIGINT NOT NULL,
    "afterTotalMinor" BIGINT NOT NULL,
    "deltaMinor" BIGINT NOT NULL,
    "sourcePricingFingerprint" CHAR(64) NOT NULL,
    "targetPricingFingerprint" CHAR(64) NOT NULL,
    "targetPricingSnapshot" JSONB NOT NULL,
    "reviewFingerprint" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_booking_commercial_amendments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_booking_commercial_amendments_dates_check" CHECK (
      "sourceStartsOn" < "sourceEndsOn"
      AND "targetStartsOn" < "targetEndsOn"
      AND ("sourceStartsOn" <> "targetStartsOn" OR "sourceEndsOn" <> "targetEndsOn")
    ),
    CONSTRAINT "rental_booking_commercial_amendments_currency_check" CHECK (
      "currency" ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT "rental_booking_commercial_amendments_money_check" CHECK (
      "beforeTotalMinor" >= 0
      AND "afterTotalMinor" >= 0
      AND "deltaMinor" > 0
      AND (
        ("direction" = 'ADDITIONAL_CHARGE' AND "afterTotalMinor" = "beforeTotalMinor" + "deltaMinor")
        OR ("direction" = 'REFUND' AND "beforeTotalMinor" = "afterTotalMinor" + "deltaMinor")
      )
    ),
    CONSTRAINT "rental_booking_commercial_amendments_custody_shape_check" CHECK (
      ("mode" = 'PRE_PICKUP_RESCHEDULE' AND "pickupEventId" IS NULL)
      OR (
        "mode" = 'CUSTODY_EXTENSION'
        AND "pickupEventId" IS NOT NULL
        AND "targetStartsOn" = "sourceStartsOn"
        AND "targetEndsOn" > "sourceEndsOn"
      )
    ),
    CONSTRAINT "rental_booking_commercial_amendments_lifecycle_check" CHECK (
      ("status" = 'PREPARED' AND "endedAt" IS NULL)
      OR ("status" IN ('CANCELLED', 'EXPIRED') AND "endedAt" IS NOT NULL)
    ),
    CONSTRAINT "rental_booking_commercial_amendments_expiry_check" CHECK (
      "expiresAt" > "createdAt"
    )
);

CREATE UNIQUE INDEX "rental_booking_commercial_amendments_id_org_key"
  ON "rental_booking_commercial_amendments"("id", "organizationId");
CREATE UNIQUE INDEX "rental_booking_commercial_amendments_org_idempotency_key"
  ON "rental_booking_commercial_amendments"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "rental_booking_commercial_amendments_org_booking_prepared_key"
  ON "rental_booking_commercial_amendments"("organizationId", "bookingId")
  WHERE "status" = 'PREPARED';
CREATE INDEX "rental_booking_commercial_amendments_org_booking_status_expiry_idx"
  ON "rental_booking_commercial_amendments"("organizationId", "bookingId", "status", "expiresAt");
CREATE INDEX "rental_booking_commercial_amendments_org_status_expiry_idx"
  ON "rental_booking_commercial_amendments"("organizationId", "status", "expiresAt");

ALTER TABLE "rental_booking_commercial_amendments"
  ADD CONSTRAINT "rental_booking_commercial_amendments_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "rental_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_commercial_amendment_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."bookingId" IS DISTINCT FROM NEW."bookingId"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."direction" IS DISTINCT FROM NEW."direction"
    OR OLD."mode" IS DISTINCT FROM NEW."mode"
    OR OLD."bookingVersion" IS DISTINCT FROM NEW."bookingVersion"
    OR OLD."unitId" IS DISTINCT FROM NEW."unitId"
    OR OLD."unitTypeId" IS DISTINCT FROM NEW."unitTypeId"
    OR OLD."locationId" IS DISTINCT FROM NEW."locationId"
    OR OLD."pickupEventId" IS DISTINCT FROM NEW."pickupEventId"
    OR OLD."sourceStartsOn" IS DISTINCT FROM NEW."sourceStartsOn"
    OR OLD."sourceEndsOn" IS DISTINCT FROM NEW."sourceEndsOn"
    OR OLD."targetStartsOn" IS DISTINCT FROM NEW."targetStartsOn"
    OR OLD."targetEndsOn" IS DISTINCT FROM NEW."targetEndsOn"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."beforeTotalMinor" IS DISTINCT FROM NEW."beforeTotalMinor"
    OR OLD."afterTotalMinor" IS DISTINCT FROM NEW."afterTotalMinor"
    OR OLD."deltaMinor" IS DISTINCT FROM NEW."deltaMinor"
    OR OLD."sourcePricingFingerprint" IS DISTINCT FROM NEW."sourcePricingFingerprint"
    OR OLD."targetPricingFingerprint" IS DISTINCT FROM NEW."targetPricingFingerprint"
    OR OLD."targetPricingSnapshot" IS DISTINCT FROM NEW."targetPricingSnapshot"
    OR OLD."reviewFingerprint" IS DISTINCT FROM NEW."reviewFingerprint"
    OR OLD."expiresAt" IS DISTINCT FROM NEW."expiresAt"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'rental booking commercial amendment terms are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'PREPARED'
    AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."endedAt" IS DISTINCT FROM OLD."endedAt")
  THEN
    RAISE EXCEPTION 'terminal rental booking commercial amendment lifecycle evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'PREPARED' AND NEW."status" NOT IN ('PREPARED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION 'invalid rental booking commercial amendment lifecycle transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sf_guard_rental_booking_commercial_amendment_terms
BEFORE UPDATE ON "rental_booking_commercial_amendments"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_commercial_amendment_terms();

CREATE OR REPLACE FUNCTION sf_block_rental_booking_commercial_amendment_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rental booking commercial amendment evidence is append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER sf_block_rental_booking_commercial_amendment_delete
BEFORE DELETE ON "rental_booking_commercial_amendments"
FOR EACH ROW
EXECUTE FUNCTION sf_block_rental_booking_commercial_amendment_delete();
