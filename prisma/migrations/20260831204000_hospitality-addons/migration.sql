CREATE TYPE "HospitalityAddonPricingModel" AS ENUM ('PER_BOOKING', 'PER_ROOM', 'PER_ROOM_NIGHT', 'PER_UNIT');

CREATE TABLE "hospitality_addons" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID,
    "ratePlanId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(300),
    "pricingModel" "HospitalityAddonPricingModel" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "hospitality_addons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_addons_scope_shape_check" CHECK (("roomTypeId" IS NULL AND "ratePlanId" IS NULL) OR ("roomTypeId" IS NOT NULL AND "ratePlanId" IS NOT NULL)),
    CONSTRAINT "hospitality_addons_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "hospitality_addons_quantity_check" CHECK ("maxQuantity" >= 1 AND "maxQuantity" <= 100),
    CONSTRAINT "hospitality_addons_non_unit_quantity_check" CHECK ("pricingModel" = 'PER_UNIT' OR "maxQuantity" = 1),
    CONSTRAINT "hospitality_addons_dates_check" CHECK ("endDate" >= "startDate")
);

CREATE UNIQUE INDEX "hospitality_addons_id_property_org_key" ON "hospitality_addons"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_addons_property_status_dates_idx" ON "hospitality_addons"("organizationId", "propertyId", "status", "startDate", "endDate");
CREATE INDEX "hospitality_addons_scope_code_idx" ON "hospitality_addons"("organizationId", "propertyId", "roomTypeId", "ratePlanId", "code", "status");

ALTER TABLE "hospitality_addons" ADD CONSTRAINT "hospitality_addons_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_addons" ADD CONSTRAINT "hospitality_addons_property_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_addons" ADD CONSTRAINT "hospitality_addons_room_type_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_addons" ADD CONSTRAINT "hospitality_addons_rate_plan_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
