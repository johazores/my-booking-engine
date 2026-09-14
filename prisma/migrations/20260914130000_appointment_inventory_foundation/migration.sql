CREATE TABLE "appointment_services" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(1000),
    "durationMinutes" INTEGER NOT NULL,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointment_services_duration_check" CHECK (
      "durationMinutes" BETWEEN 5 AND 1440
      AND "bufferBeforeMinutes" BETWEEN 0 AND 480
      AND "bufferAfterMinutes" BETWEEN 0 AND 480
      AND ("durationMinutes" + "bufferBeforeMinutes" + "bufferAfterMinutes") <= 1440
    ),
    CONSTRAINT "appointment_services_archive_state_check" CHECK (
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
    )
);

CREATE TABLE "appointment_staff" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(1000),
    "timezone" VARCHAR(80) NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "appointment_staff_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointment_staff_archive_state_check" CHECK (
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
    )
);

CREATE TABLE "appointment_staff_services" (
    "organizationId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_staff_services_pkey" PRIMARY KEY ("organizationId", "staffId", "serviceId")
);

CREATE TABLE "appointment_schedules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startsAtMinute" INTEGER NOT NULL,
    "endsAtMinute" INTEGER NOT NULL,
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "appointment_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointment_schedules_window_check" CHECK (
      "dayOfWeek" BETWEEN 0 AND 6
      AND "startsAtMinute" BETWEEN 0 AND 1439
      AND "endsAtMinute" BETWEEN 1 AND 1440
      AND "endsAtMinute" > "startsAtMinute"
    ),
    CONSTRAINT "appointment_schedules_archive_state_check" CHECK (
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "appointment_services_id_org_key" ON "appointment_services"("id", "organizationId");
CREATE UNIQUE INDEX "appointment_services_org_code_key" ON "appointment_services"("organizationId", "code");
CREATE INDEX "appointment_services_org_status_name_idx" ON "appointment_services"("organizationId", "status", "name");

CREATE UNIQUE INDEX "appointment_staff_id_org_key" ON "appointment_staff"("id", "organizationId");
CREATE UNIQUE INDEX "appointment_staff_org_code_key" ON "appointment_staff"("organizationId", "code");
CREATE INDEX "appointment_staff_org_status_name_idx" ON "appointment_staff"("organizationId", "status", "name");

CREATE INDEX "appointment_staff_services_org_service_idx" ON "appointment_staff_services"("organizationId", "serviceId");

CREATE UNIQUE INDEX "appointment_schedules_id_org_key" ON "appointment_schedules"("id", "organizationId");
CREATE UNIQUE INDEX "appointment_schedules_staff_window_key" ON "appointment_schedules"("staffId", "dayOfWeek", "startsAtMinute", "endsAtMinute");
CREATE INDEX "appointment_schedules_org_staff_status_day_idx" ON "appointment_schedules"("organizationId", "staffId", "status", "dayOfWeek", "startsAtMinute");

ALTER TABLE "appointment_services"
  ADD CONSTRAINT "appointment_services_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_staff"
  ADD CONSTRAINT "appointment_staff_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_staff_services"
  ADD CONSTRAINT "appointment_staff_services_staff_tenant_fkey"
  FOREIGN KEY ("staffId", "organizationId") REFERENCES "appointment_staff"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_staff_services"
  ADD CONSTRAINT "appointment_staff_services_service_tenant_fkey"
  FOREIGN KEY ("serviceId", "organizationId") REFERENCES "appointment_services"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_schedules"
  ADD CONSTRAINT "appointment_schedules_staff_tenant_fkey"
  FOREIGN KEY ("staffId", "organizationId") REFERENCES "appointment_staff"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
