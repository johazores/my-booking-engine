CREATE TABLE "rental_unit_types" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(1000),
    "currency" CHAR(3) NOT NULL,
    "defaultDailyRateMinor" INTEGER NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_unit_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rental_units" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitTypeId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(1000),
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rental_availability_blocks" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_availability_blocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rental_rate_periods" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitTypeId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "dailyRateMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_rate_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_unit_types_id_organizationId_key" ON "rental_unit_types"("id", "organizationId");
CREATE UNIQUE INDEX "rental_unit_types_organizationId_code_key" ON "rental_unit_types"("organizationId", "code");
CREATE INDEX "rental_unit_types_organizationId_status_name_idx" ON "rental_unit_types"("organizationId", "status", "name");

CREATE UNIQUE INDEX "rental_units_id_organizationId_key" ON "rental_units"("id", "organizationId");
CREATE UNIQUE INDEX "rental_units_organizationId_code_key" ON "rental_units"("organizationId", "code");
CREATE INDEX "rental_units_organizationId_unitTypeId_status_name_idx" ON "rental_units"("organizationId", "unitTypeId", "status", "name");

CREATE UNIQUE INDEX "rental_availability_blocks_id_organizationId_key" ON "rental_availability_blocks"("id", "organizationId");
CREATE INDEX "rental_availability_blocks_organizationId_unitId_startsOn_endsOn_idx" ON "rental_availability_blocks"("organizationId", "unitId", "startsOn", "endsOn");

CREATE UNIQUE INDEX "rental_rate_periods_id_organizationId_key" ON "rental_rate_periods"("id", "organizationId");
CREATE INDEX "rental_rate_periods_organizationId_unitTypeId_startsOn_endsOn_idx" ON "rental_rate_periods"("organizationId", "unitTypeId", "startsOn", "endsOn");

ALTER TABLE "rental_units"
ADD CONSTRAINT "rental_units_unitTypeId_organizationId_fkey"
FOREIGN KEY ("unitTypeId", "organizationId") REFERENCES "rental_unit_types"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_availability_blocks"
ADD CONSTRAINT "rental_availability_blocks_unitId_organizationId_fkey"
FOREIGN KEY ("unitId", "organizationId") REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_rate_periods"
ADD CONSTRAINT "rental_rate_periods_unitTypeId_organizationId_fkey"
FOREIGN KEY ("unitTypeId", "organizationId") REFERENCES "rental_unit_types"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_unit_types"
ADD CONSTRAINT "rental_unit_types_defaultDailyRateMinor_check" CHECK ("defaultDailyRateMinor" > 0);

ALTER TABLE "rental_rate_periods"
ADD CONSTRAINT "rental_rate_periods_dailyRateMinor_check" CHECK ("dailyRateMinor" > 0);

ALTER TABLE "rental_availability_blocks"
ADD CONSTRAINT "rental_availability_blocks_date_range_check" CHECK ("startsOn" < "endsOn");

ALTER TABLE "rental_rate_periods"
ADD CONSTRAINT "rental_rate_periods_date_range_check" CHECK ("startsOn" < "endsOn");
