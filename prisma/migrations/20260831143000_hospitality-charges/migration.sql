CREATE TYPE "HospitalityChargeKind" AS ENUM ('TAX', 'FEE');
CREATE TYPE "HospitalityChargeCalculation" AS ENUM ('PERCENTAGE', 'FIXED_PER_BOOKING', 'FIXED_PER_ROOM_NIGHT');

CREATE TABLE "hospitality_charge_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID,
    "ratePlanId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "kind" "HospitalityChargeKind" NOT NULL,
    "calculation" "HospitalityChargeCalculation" NOT NULL,
    "percentageBps" INTEGER,
    "amountMinor" BIGINT,
    "currency" CHAR(3),
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_charge_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_charge_rules_name_not_blank" CHECK ("name" = btrim("name") AND char_length("name") > 0),
    CONSTRAINT "hospitality_charge_rules_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT "hospitality_charge_rules_scope_consistent" CHECK (("roomTypeId" IS NULL AND "ratePlanId" IS NULL) OR ("roomTypeId" IS NOT NULL AND "ratePlanId" IS NOT NULL)),
    CONSTRAINT "hospitality_charge_rules_dates_check" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "hospitality_charge_rules_value_check" CHECK (
      ("calculation" = 'PERCENTAGE' AND "percentageBps" IS NOT NULL AND "percentageBps" BETWEEN 1 AND 10000 AND "amountMinor" IS NULL AND "currency" IS NULL)
      OR
      ("calculation" IN ('FIXED_PER_BOOKING', 'FIXED_PER_ROOM_NIGHT') AND "percentageBps" IS NULL AND "amountMinor" IS NOT NULL AND "amountMinor" > 0 AND "amountMinor" <= 9000000000000000 AND "currency" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$')
    ),
    CONSTRAINT "hospitality_charge_rules_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_charge_rules_id_property_org_key" ON "hospitality_charge_rules"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_charge_rules_property_status_dates_idx" ON "hospitality_charge_rules"("organizationId", "propertyId", "status", "startDate", "endDate");
CREATE INDEX "hospitality_charge_rules_scope_code_idx" ON "hospitality_charge_rules"("organizationId", "propertyId", "roomTypeId", "ratePlanId", "code", "status");

ALTER TABLE "hospitality_charge_rules" ADD CONSTRAINT "hospitality_charge_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_charge_rules" ADD CONSTRAINT "hospitality_charge_rules_property_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_charge_rules" ADD CONSTRAINT "hospitality_charge_rules_room_type_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_charge_rules" ADD CONSTRAINT "hospitality_charge_rules_rate_plan_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
