CREATE TYPE "HospitalityBookingCommercialAmendmentStatus" AS ENUM ('PREPARED', 'CANCELLED', 'EXPIRED', 'APPLIED');
CREATE TYPE "HospitalityBookingCommercialAmendmentDirection" AS ENUM ('ADDITIONAL_CHARGE', 'REFUND');

CREATE TABLE "hospitality_booking_commercial_amendments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" "HospitalityBookingCommercialAmendmentStatus" NOT NULL DEFAULT 'PREPARED',
    "direction" "HospitalityBookingCommercialAmendmentDirection" NOT NULL,
    "bookingVersion" TIMESTAMPTZ(6) NOT NULL,
    "selectionFingerprint" CHAR(64) NOT NULL,
    "adjustmentFingerprint" CHAR(64) NOT NULL,
    "paymentProviderCode" VARCHAR(40) NOT NULL,
    "propertyId" UUID NOT NULL,
    "currentRoomTypeId" UUID NOT NULL,
    "currentRatePlanId" UUID NOT NULL,
    "currentQuantity" INTEGER NOT NULL,
    "currentAddonSelections" JSONB NOT NULL,
    "targetRoomTypeId" UUID NOT NULL,
    "targetRatePlanId" UUID NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "targetAddonSelections" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "beforeAccommodationSubtotalMinor" BIGINT NOT NULL,
    "beforeTaxTotalMinor" BIGINT NOT NULL,
    "beforeFeeTotalMinor" BIGINT NOT NULL,
    "beforeAddonTotalMinor" BIGINT NOT NULL,
    "beforeTotalMinor" BIGINT NOT NULL,
    "beforePricingFingerprint" CHAR(64) NOT NULL,
    "afterAccommodationSubtotalMinor" BIGINT NOT NULL,
    "afterTaxTotalMinor" BIGINT NOT NULL,
    "afterFeeTotalMinor" BIGINT NOT NULL,
    "afterAddonTotalMinor" BIGINT NOT NULL,
    "afterTotalMinor" BIGINT NOT NULL,
    "afterPricingFingerprint" CHAR(64) NOT NULL,
    "deltaMinor" BIGINT NOT NULL,
    "targetHoldId" UUID,
    "protectionQuantity" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "appliedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "hospitality_booking_commercial_amendments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_booking_commercial_amendments_quantities_check" CHECK (
      "currentQuantity" > 0 AND "targetQuantity" > 0 AND "protectionQuantity" >= 0
    ),
    CONSTRAINT "hospitality_booking_commercial_amendments_before_total_check" CHECK (
      "beforeAccommodationSubtotalMinor" >= 0
      AND "beforeTaxTotalMinor" >= 0
      AND "beforeFeeTotalMinor" >= 0
      AND "beforeAddonTotalMinor" >= 0
      AND "beforeTotalMinor" = "beforeAccommodationSubtotalMinor" + "beforeTaxTotalMinor" + "beforeFeeTotalMinor" + "beforeAddonTotalMinor"
    ),
    CONSTRAINT "hospitality_booking_commercial_amendments_after_total_check" CHECK (
      "afterAccommodationSubtotalMinor" >= 0
      AND "afterTaxTotalMinor" >= 0
      AND "afterFeeTotalMinor" >= 0
      AND "afterAddonTotalMinor" >= 0
      AND "afterTotalMinor" = "afterAccommodationSubtotalMinor" + "afterTaxTotalMinor" + "afterFeeTotalMinor" + "afterAddonTotalMinor"
    ),
    CONSTRAINT "hospitality_booking_commercial_amendments_delta_check" CHECK (
      "deltaMinor" = "afterTotalMinor" - "beforeTotalMinor"
      AND "deltaMinor" <> 0
      AND (("direction" = 'ADDITIONAL_CHARGE' AND "deltaMinor" > 0) OR ("direction" = 'REFUND' AND "deltaMinor" < 0))
    ),
    CONSTRAINT "hospitality_booking_commercial_amendments_hold_check" CHECK (
      ("targetHoldId" IS NULL AND "protectionQuantity" = 0)
      OR ("targetHoldId" IS NOT NULL AND "protectionQuantity" > 0)
    ),
    CONSTRAINT "hospitality_booking_commercial_amendments_lifecycle_check" CHECK (
      ("status" = 'PREPARED' AND "endedAt" IS NULL AND "appliedAt" IS NULL)
      OR ("status" IN ('CANCELLED', 'EXPIRED') AND "endedAt" IS NOT NULL AND "appliedAt" IS NULL)
      OR ("status" = 'APPLIED' AND "endedAt" IS NOT NULL AND "appliedAt" IS NOT NULL)
    ),
    CONSTRAINT "hospitality_booking_commercial_amendments_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "hospitality_booking_commercial_amendments_id_org_key"
  ON "hospitality_booking_commercial_amendments"("id", "organizationId");
CREATE UNIQUE INDEX "hospitality_booking_commercial_amendments_org_idempotency_key"
  ON "hospitality_booking_commercial_amendments"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "hospitality_booking_commercial_amendments_org_target_hold_key"
  ON "hospitality_booking_commercial_amendments"("organizationId", "targetHoldId");
CREATE INDEX "hospitality_booking_commercial_amendments_org_booking_status_expiry_idx"
  ON "hospitality_booking_commercial_amendments"("organizationId", "bookingId", "status", "expiresAt");
CREATE INDEX "hospitality_booking_commercial_amendments_org_status_expiry_idx"
  ON "hospitality_booking_commercial_amendments"("organizationId", "status", "expiresAt");

ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_property_fkey"
  FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_current_room_type_fkey"
  FOREIGN KEY ("currentRoomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_target_room_type_fkey"
  FOREIGN KEY ("targetRoomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_current_rate_plan_fkey"
  FOREIGN KEY ("currentRatePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_target_rate_plan_fkey"
  FOREIGN KEY ("targetRatePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_commercial_amendments"
  ADD CONSTRAINT "hospitality_booking_commercial_amendments_target_hold_fkey"
  FOREIGN KEY ("targetHoldId", "organizationId") REFERENCES "hospitality_availability_holds"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
