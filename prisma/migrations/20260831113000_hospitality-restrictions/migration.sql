CREATE TABLE "hospitality_restrictions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "roomTypeId" UUID,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "minStayNights" INTEGER,
    "maxStayNights" INTEGER,
    "closedToArrival" BOOLEAN NOT NULL DEFAULT false,
    "closedToDeparture" BOOLEAN NOT NULL DEFAULT false,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_restrictions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_restrictions_date_range_check" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "hospitality_restrictions_min_stay_check" CHECK ("minStayNights" IS NULL OR ("minStayNights" >= 1 AND "minStayNights" <= 365)),
    CONSTRAINT "hospitality_restrictions_max_stay_check" CHECK ("maxStayNights" IS NULL OR ("maxStayNights" >= 1 AND "maxStayNights" <= 365)),
    CONSTRAINT "hospitality_restrictions_stay_range_check" CHECK ("minStayNights" IS NULL OR "maxStayNights" IS NULL OR "minStayNights" <= "maxStayNights"),
    CONSTRAINT "hospitality_restrictions_rule_present_check" CHECK ("minStayNights" IS NOT NULL OR "maxStayNights" IS NOT NULL OR "closedToArrival" OR "closedToDeparture"),
    CONSTRAINT "hospitality_restrictions_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_restrictions_id_propertyId_organizationId_key" ON "hospitality_restrictions"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_restrictions_organizationId_propertyId_ratePlanId_status_startDate_idx" ON "hospitality_restrictions"("organizationId", "propertyId", "ratePlanId", "status", "startDate");
CREATE INDEX "hospitality_restrictions_organizationId_propertyId_roomTypeId_status_startDate_idx" ON "hospitality_restrictions"("organizationId", "propertyId", "roomTypeId", "status", "startDate");

ALTER TABLE "hospitality_restrictions" ADD CONSTRAINT "hospitality_restrictions_ratePlanId_propertyId_organizationId_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_restrictions" ADD CONSTRAINT "hospitality_restrictions_roomTypeId_propertyId_organizationId_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
