CREATE TABLE "hospitality_base_rates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_base_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_base_rates_date_order" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "hospitality_base_rates_amount_positive" CHECK ("amountMinor" > 0 AND "amountMinor" <= 9000000000000000),
    CONSTRAINT "hospitality_base_rates_currency_canonical" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "hospitality_base_rates_archive_state" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_base_rates_id_property_org_key" ON "hospitality_base_rates"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_base_rates_scope_dates_idx" ON "hospitality_base_rates"("organizationId", "propertyId", "roomTypeId", "ratePlanId", "status", "startDate", "endDate");

ALTER TABLE "hospitality_base_rates" ADD CONSTRAINT "hospitality_base_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_base_rates" ADD CONSTRAINT "hospitality_base_rates_propertyId_organizationId_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_base_rates" ADD CONSTRAINT "hospitality_base_rates_room_type_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_base_rates" ADD CONSTRAINT "hospitality_base_rates_rate_plan_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
