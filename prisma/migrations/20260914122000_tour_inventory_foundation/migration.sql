CREATE TYPE "TourProductKind" AS ENUM ('TOUR', 'PACKAGE');

CREATE TABLE "tour_products" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "TourProductKind" NOT NULL DEFAULT 'TOUR',
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(1000),
    "timezone" VARCHAR(80) NOT NULL,
    "meetingPoint" VARCHAR(300),
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tour_products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tour_products_archive_state_check" CHECK (
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
    )
);

CREATE TABLE "tour_departures" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tourProductId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tour_departures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tour_departures_time_check" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + INTERVAL '31 days'),
    CONSTRAINT "tour_departures_capacity_check" CHECK ("capacity" BETWEEN 1 AND 10000),
    CONSTRAINT "tour_departures_archive_state_check" CHECK (
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
    )
);

CREATE TABLE "tour_addons" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tourProductId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(500),
    "maxQuantityPerBooking" INTEGER NOT NULL DEFAULT 1,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tour_addons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tour_addons_quantity_check" CHECK ("maxQuantityPerBooking" BETWEEN 1 AND 100),
    CONSTRAINT "tour_addons_archive_state_check" CHECK (
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "tour_products_id_organizationId_key" ON "tour_products"("id", "organizationId");
CREATE UNIQUE INDEX "tour_products_organizationId_code_key" ON "tour_products"("organizationId", "code");
CREATE INDEX "tour_products_org_status_name_idx" ON "tour_products"("organizationId", "status", "name");

CREATE UNIQUE INDEX "tour_departures_id_organizationId_key" ON "tour_departures"("id", "organizationId");
CREATE UNIQUE INDEX "tour_departures_tourProductId_startsAt_key" ON "tour_departures"("tourProductId", "startsAt");
CREATE INDEX "tour_departures_org_product_status_start_idx" ON "tour_departures"("organizationId", "tourProductId", "status", "startsAt");

CREATE UNIQUE INDEX "tour_addons_id_organizationId_key" ON "tour_addons"("id", "organizationId");
CREATE UNIQUE INDEX "tour_addons_tourProductId_code_key" ON "tour_addons"("tourProductId", "code");
CREATE INDEX "tour_addons_org_product_status_name_idx" ON "tour_addons"("organizationId", "tourProductId", "status", "name");

ALTER TABLE "tour_products"
  ADD CONSTRAINT "tour_products_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tour_departures"
  ADD CONSTRAINT "tour_departures_product_tenant_fkey"
  FOREIGN KEY ("tourProductId", "organizationId") REFERENCES "tour_products"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tour_addons"
  ADD CONSTRAINT "tour_addons_product_tenant_fkey"
  FOREIGN KEY ("tourProductId", "organizationId") REFERENCES "tour_products"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
