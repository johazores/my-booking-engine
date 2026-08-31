CREATE TYPE "InventoryLifecycleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "RoomOperationalStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'ARCHIVED');

CREATE TABLE "hospitality_properties" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" VARCHAR(80) NOT NULL,
    "addressLine1" VARCHAR(200),
    "city" VARCHAR(120),
    "region" VARCHAR(120),
    "postalCode" VARCHAR(24),
    "countryCode" CHAR(2) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_properties_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_properties_name_not_blank" CHECK ("name" = btrim("name") AND char_length("name") > 0),
    CONSTRAINT "hospitality_properties_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT "hospitality_properties_country_canonical" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
    CONSTRAINT "hospitality_properties_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE TABLE "hospitality_room_types" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxOccupancy" INTEGER NOT NULL,
    "bedsDescription" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_room_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_room_types_name_not_blank" CHECK ("name" = btrim("name") AND char_length("name") > 0),
    CONSTRAINT "hospitality_room_types_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT "hospitality_room_types_max_occupancy_check" CHECK ("maxOccupancy" >= 1 AND "maxOccupancy" <= 50),
    CONSTRAINT "hospitality_room_types_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE TABLE "hospitality_rooms" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "floor" VARCHAR(40),
    "status" "RoomOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_rooms_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT "hospitality_rooms_archive_state_consistent" CHECK (("status" IN ('ACTIVE', 'OUT_OF_SERVICE') AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_properties_organizationId_code_key" ON "hospitality_properties"("organizationId", "code");
CREATE UNIQUE INDEX "hospitality_properties_id_organizationId_key" ON "hospitality_properties"("id", "organizationId");
CREATE INDEX "hospitality_properties_organizationId_status_name_idx" ON "hospitality_properties"("organizationId", "status", "name");
CREATE UNIQUE INDEX "hospitality_room_types_propertyId_code_key" ON "hospitality_room_types"("propertyId", "code");
CREATE UNIQUE INDEX "hospitality_room_types_id_propertyId_organizationId_key" ON "hospitality_room_types"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_room_types_organizationId_status_name_idx" ON "hospitality_room_types"("organizationId", "status", "name");
CREATE INDEX "hospitality_room_types_propertyId_status_idx" ON "hospitality_room_types"("propertyId", "status");
CREATE UNIQUE INDEX "hospitality_rooms_propertyId_code_key" ON "hospitality_rooms"("propertyId", "code");
CREATE INDEX "hospitality_rooms_organizationId_status_code_idx" ON "hospitality_rooms"("organizationId", "status", "code");
CREATE INDEX "hospitality_rooms_roomTypeId_status_idx" ON "hospitality_rooms"("roomTypeId", "status");

ALTER TABLE "hospitality_properties" ADD CONSTRAINT "hospitality_properties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_room_types" ADD CONSTRAINT "hospitality_room_types_propertyId_organizationId_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_rooms" ADD CONSTRAINT "hospitality_rooms_roomTypeId_propertyId_organizationId_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
