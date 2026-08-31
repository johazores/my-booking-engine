CREATE TYPE "AvailabilityHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

CREATE TABLE "hospitality_availability_holds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "AvailabilityHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "hospitality_availability_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_availability_holds_dates_check" CHECK ("departureDate" > "arrivalDate"),
    CONSTRAINT "hospitality_availability_holds_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 50),
    CONSTRAINT "hospitality_availability_holds_idempotency_key_check" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{8,120}$'),
    CONSTRAINT "hospitality_availability_holds_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "hospitality_availability_holds_state_check" CHECK (("status" = 'ACTIVE' AND "endedAt" IS NULL) OR ("status" IN ('RELEASED', 'EXPIRED') AND "endedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_holds_org_idempotency_key" ON "hospitality_availability_holds"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "hospitality_availability_holds_id_organizationId_key" ON "hospitality_availability_holds"("id", "organizationId");
CREATE INDEX "hospitality_holds_scope_dates_idx" ON "hospitality_availability_holds"("organizationId", "propertyId", "roomTypeId", "status", "arrivalDate", "departureDate");
CREATE INDEX "hospitality_holds_status_expiry_idx" ON "hospitality_availability_holds"("organizationId", "status", "expiresAt");

ALTER TABLE "hospitality_availability_holds" ADD CONSTRAINT "hospitality_availability_holds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_availability_holds" ADD CONSTRAINT "hospitality_holds_room_type_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_availability_holds" ADD CONSTRAINT "hospitality_holds_rate_plan_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
