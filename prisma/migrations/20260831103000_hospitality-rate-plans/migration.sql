CREATE TABLE "hospitality_rate_plans" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(300),
    "status" "InventoryLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_rate_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_rate_plans_name_not_blank" CHECK ("name" = btrim("name") AND char_length("name") > 0),
    CONSTRAINT "hospitality_rate_plans_code_canonical" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT "hospitality_rate_plans_description_not_blank" CHECK ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") > 0)),
    CONSTRAINT "hospitality_rate_plans_archive_state_consistent" CHECK (("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL))
);

CREATE TABLE "hospitality_room_type_rate_plans" (
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_room_type_rate_plans_pkey" PRIMARY KEY ("organizationId", "roomTypeId", "ratePlanId")
);

CREATE UNIQUE INDEX "hospitality_rate_plans_propertyId_code_key" ON "hospitality_rate_plans"("propertyId", "code");
CREATE UNIQUE INDEX "hospitality_rate_plans_id_propertyId_organizationId_key" ON "hospitality_rate_plans"("id", "propertyId", "organizationId");
CREATE INDEX "hospitality_rate_plans_organizationId_status_name_idx" ON "hospitality_rate_plans"("organizationId", "status", "name");
CREATE INDEX "hospitality_rate_plans_propertyId_status_name_idx" ON "hospitality_rate_plans"("propertyId", "status", "name");
CREATE INDEX "hospitality_room_type_rate_plans_organizationId_ratePlanId_idx" ON "hospitality_room_type_rate_plans"("organizationId", "ratePlanId");
CREATE INDEX "hospitality_room_type_rate_plans_propertyId_roomTypeId_idx" ON "hospitality_room_type_rate_plans"("propertyId", "roomTypeId");

ALTER TABLE "hospitality_rate_plans" ADD CONSTRAINT "hospitality_rate_plans_propertyId_organizationId_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_room_type_rate_plans" ADD CONSTRAINT "hospitality_room_type_rate_plans_roomTypeId_propertyId_organizationId_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospitality_room_type_rate_plans" ADD CONSTRAINT "hospitality_room_type_rate_plans_ratePlanId_propertyId_organizationId_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
