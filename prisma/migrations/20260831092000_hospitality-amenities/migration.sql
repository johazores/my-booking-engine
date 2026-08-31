CREATE TABLE "hospitality_amenities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_amenities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_amenities_name_not_blank" CHECK ("name" = btrim("name") AND char_length("name") > 0),
    CONSTRAINT "hospitality_amenities_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT "hospitality_amenities_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE TABLE "hospitality_property_amenities" (
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "amenityId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_property_amenities_pkey" PRIMARY KEY ("organizationId", "propertyId", "amenityId")
);

CREATE TABLE "hospitality_room_type_amenities" (
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "amenityId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_room_type_amenities_pkey" PRIMARY KEY ("organizationId", "roomTypeId", "amenityId")
);

CREATE UNIQUE INDEX "hospitality_amenities_organizationId_code_key" ON "hospitality_amenities"("organizationId", "code");
CREATE UNIQUE INDEX "hospitality_amenities_id_organizationId_key" ON "hospitality_amenities"("id", "organizationId");
CREATE INDEX "hospitality_amenities_organizationId_status_name_idx" ON "hospitality_amenities"("organizationId", "status", "name");
CREATE INDEX "hospitality_property_amenities_organizationId_amenityId_idx" ON "hospitality_property_amenities"("organizationId", "amenityId");
CREATE INDEX "hospitality_room_type_amenities_organizationId_amenityId_idx" ON "hospitality_room_type_amenities"("organizationId", "amenityId");
CREATE INDEX "hospitality_room_type_amenities_propertyId_roomTypeId_idx" ON "hospitality_room_type_amenities"("propertyId", "roomTypeId");

ALTER TABLE "hospitality_amenities" ADD CONSTRAINT "hospitality_amenities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_property_amenities" ADD CONSTRAINT "hospitality_property_amenities_propertyId_organizationId_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospitality_property_amenities" ADD CONSTRAINT "hospitality_property_amenities_amenityId_organizationId_fkey" FOREIGN KEY ("amenityId", "organizationId") REFERENCES "hospitality_amenities"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospitality_room_type_amenities" ADD CONSTRAINT "hospitality_room_type_amenities_roomTypeId_propertyId_organizationId_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospitality_room_type_amenities" ADD CONSTRAINT "hospitality_room_type_amenities_amenityId_organizationId_fkey" FOREIGN KEY ("amenityId", "organizationId") REFERENCES "hospitality_amenities"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
