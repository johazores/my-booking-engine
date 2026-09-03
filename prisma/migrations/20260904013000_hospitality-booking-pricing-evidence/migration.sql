CREATE TYPE "HospitalityBookingPricingEvidenceSource" AS ENUM (
  'BOOKING_CONFIRMATION',
  'BOOKING_RESCHEDULE',
  'BOOKING_COMMERCIAL_MODIFICATION',
  'COMMERCIAL_AMENDMENT_TARGET',
  'COMMERCIAL_AMENDMENT_APPLY'
);

CREATE TABLE "hospitality_booking_pricing_evidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "commercialAmendmentId" UUID,
    "evidenceKey" VARCHAR(220) NOT NULL,
    "source" "HospitalityBookingPricingEvidenceSource" NOT NULL,
    "bookingVersion" TIMESTAMPTZ(6) NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "addonSelections" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "accommodationSubtotalMinor" BIGINT NOT NULL,
    "taxTotalMinor" BIGINT NOT NULL,
    "feeTotalMinor" BIGINT NOT NULL,
    "addonTotalMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "pricingFingerprint" CHAR(64) NOT NULL,
    "pricingBreakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_booking_pricing_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_booking_pricing_evidence_dates_check" CHECK ("departureDate" > "arrivalDate"),
    CONSTRAINT "hospitality_booking_pricing_evidence_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 50),
    CONSTRAINT "hospitality_booking_pricing_evidence_key_check" CHECK (char_length("evidenceKey") >= 8),
    CONSTRAINT "hospitality_booking_pricing_evidence_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "hospitality_booking_pricing_evidence_fingerprint_check" CHECK ("pricingFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "hospitality_booking_pricing_evidence_json_check" CHECK (
      jsonb_typeof("addonSelections") = 'array'
      AND jsonb_typeof("pricingBreakdown") = 'object'
      AND "pricingBreakdown"->>'schemaVersion' = '1'
    ),
    CONSTRAINT "hospitality_booking_pricing_evidence_money_check" CHECK (
      "accommodationSubtotalMinor" >= 0
      AND "taxTotalMinor" >= 0
      AND "feeTotalMinor" >= 0
      AND "addonTotalMinor" >= 0
      AND "totalMinor" = "accommodationSubtotalMinor" + "taxTotalMinor" + "feeTotalMinor" + "addonTotalMinor"
    ),
    CONSTRAINT "hospitality_booking_pricing_evidence_amendment_source_check" CHECK (
      ("source" IN ('COMMERCIAL_AMENDMENT_TARGET', 'COMMERCIAL_AMENDMENT_APPLY') AND "commercialAmendmentId" IS NOT NULL)
      OR ("source" IN ('BOOKING_CONFIRMATION', 'BOOKING_RESCHEDULE', 'BOOKING_COMMERCIAL_MODIFICATION') AND "commercialAmendmentId" IS NULL)
    )
);

CREATE UNIQUE INDEX "hospitality_booking_pricing_evidence_id_org_key"
  ON "hospitality_booking_pricing_evidence"("id", "organizationId");
CREATE UNIQUE INDEX "hospitality_booking_pricing_evidence_org_key"
  ON "hospitality_booking_pricing_evidence"("organizationId", "evidenceKey");
CREATE INDEX "hospitality_booking_pricing_evidence_org_booking_created_idx"
  ON "hospitality_booking_pricing_evidence"("organizationId", "bookingId", "createdAt");
CREATE INDEX "hospitality_booking_pricing_evidence_org_amendment_source_idx"
  ON "hospitality_booking_pricing_evidence"("organizationId", "commercialAmendmentId", "source");

ALTER TABLE "hospitality_booking_pricing_evidence"
  ADD CONSTRAINT "hospitality_booking_pricing_evidence_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_pricing_evidence"
  ADD CONSTRAINT "hospitality_booking_pricing_evidence_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_pricing_evidence"
  ADD CONSTRAINT "hospitality_booking_pricing_evidence_property_fkey"
  FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_pricing_evidence"
  ADD CONSTRAINT "hospitality_booking_pricing_evidence_room_type_fkey"
  FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_pricing_evidence"
  ADD CONSTRAINT "hospitality_booking_pricing_evidence_rate_plan_fkey"
  FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_pricing_evidence"
  ADD CONSTRAINT "hospitality_booking_pricing_evidence_amendment_fkey"
  FOREIGN KEY ("commercialAmendmentId", "bookingId", "organizationId")
  REFERENCES "hospitality_booking_commercial_amendments"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
