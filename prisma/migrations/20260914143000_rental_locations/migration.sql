CREATE TABLE "rental_locations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "addressLine1" VARCHAR(200) NOT NULL,
    "addressLine2" VARCHAR(200),
    "city" VARCHAR(120) NOT NULL,
    "region" VARCHAR(120),
    "postalCode" VARCHAR(32),
    "countryCode" CHAR(2) NOT NULL,
    "timeZone" VARCHAR(80) NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rental_units" ADD COLUMN "locationId" UUID;

CREATE UNIQUE INDEX "rental_locations_id_organizationId_key" ON "rental_locations"("id", "organizationId");
CREATE UNIQUE INDEX "rental_locations_organizationId_code_key" ON "rental_locations"("organizationId", "code");
CREATE INDEX "rental_locations_organizationId_status_name_idx" ON "rental_locations"("organizationId", "status", "name");
CREATE INDEX "rental_units_organizationId_locationId_status_name_idx" ON "rental_units"("organizationId", "locationId", "status", "name");

ALTER TABLE "rental_units"
ADD CONSTRAINT "rental_units_locationId_organizationId_fkey"
FOREIGN KEY ("locationId", "organizationId") REFERENCES "rental_locations"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
