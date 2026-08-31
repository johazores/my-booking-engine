CREATE TABLE "hospitality_availability_windows" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "capacityLimit" INTEGER NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_availability_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_availability_windows_date_range_check" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "hospitality_availability_windows_capacity_check" CHECK ("capacityLimit" >= 0 AND "capacityLimit" <= 50),
    CONSTRAINT "hospitality_availability_windows_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_availability_windows_id_propertyId_organizationId_key" ON "hospitality_availability_windows"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_availability_windows_organizationId_propertyId_roomTypeId_status_startDate_idx" ON "hospitality_availability_windows"("organizationId", "propertyId", "roomTypeId", "status", "startDate");

ALTER TABLE "hospitality_availability_windows" ADD CONSTRAINT "hospitality_availability_windows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_availability_windows" ADD CONSTRAINT "hospitality_availability_windows_roomTypeId_propertyId_organizationId_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
