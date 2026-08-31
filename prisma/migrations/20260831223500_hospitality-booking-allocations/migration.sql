ALTER TYPE "AvailabilityHoldStatus" ADD VALUE 'CONSUMED';

ALTER TABLE "hospitality_availability_holds" DROP CONSTRAINT "hospitality_availability_holds_state_check";
ALTER TABLE "hospitality_availability_holds" ADD CONSTRAINT "hospitality_availability_holds_state_check" CHECK (("status" = 'ACTIVE' AND "endedAt" IS NULL) OR ("status" IN ('RELEASED', 'EXPIRED', 'CONSUMED') AND "endedAt" IS NOT NULL));

CREATE UNIQUE INDEX "customers_id_organizationId_key" ON "customers"("id", "organizationId");

CREATE TYPE "BookingStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'AUTHORIZED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');

CREATE TABLE "hospitality_bookings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "holdId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "accommodationSubtotalMinor" BIGINT NOT NULL,
    "taxTotalMinor" BIGINT NOT NULL,
    "feeTotalMinor" BIGINT NOT NULL,
    "addonTotalMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "pricingFingerprint" CHAR(64) NOT NULL,
    "addonSelections" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    CONSTRAINT "hospitality_bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_bookings_dates_check" CHECK ("departureDate" > "arrivalDate"),
    CONSTRAINT "hospitality_bookings_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 50),
    CONSTRAINT "hospitality_bookings_idempotency_key_check" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{8,120}$'),
    CONSTRAINT "hospitality_bookings_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "hospitality_bookings_fingerprint_check" CHECK ("pricingFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "hospitality_bookings_money_check" CHECK ("accommodationSubtotalMinor" >= 0 AND "taxTotalMinor" >= 0 AND "feeTotalMinor" >= 0 AND "addonTotalMinor" >= 0 AND "totalMinor" = "accommodationSubtotalMinor" + "taxTotalMinor" + "feeTotalMinor" + "addonTotalMinor"),
    CONSTRAINT "hospitality_bookings_state_timestamps_check" CHECK (("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "cancelledAt" IS NULL) OR ("status" = 'PENDING_CONFIRMATION' AND "confirmedAt" IS NULL AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "hospitality_bookings_id_organizationId_key" ON "hospitality_bookings"("id", "organizationId");
CREATE UNIQUE INDEX "hospitality_bookings_org_idempotency_key" ON "hospitality_bookings"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "hospitality_bookings_org_hold_key" ON "hospitality_bookings"("organizationId", "holdId");
CREATE INDEX "hospitality_bookings_org_status_created_idx" ON "hospitality_bookings"("organizationId", "status", "createdAt");
CREATE INDEX "hospitality_bookings_customer_created_idx" ON "hospitality_bookings"("organizationId", "customerId", "createdAt");
CREATE INDEX "hospitality_bookings_stay_idx" ON "hospitality_bookings"("organizationId", "propertyId", "roomTypeId", "arrivalDate", "departureDate");

CREATE TABLE "hospitality_booking_allocations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_booking_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_booking_allocations_dates_check" CHECK ("departureDate" > "arrivalDate"),
    CONSTRAINT "hospitality_booking_allocations_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 50)
);

CREATE UNIQUE INDEX "hospitality_allocations_org_booking_key" ON "hospitality_booking_allocations"("organizationId", "bookingId");
CREATE INDEX "hospitality_allocations_scope_dates_idx" ON "hospitality_booking_allocations"("organizationId", "propertyId", "roomTypeId", "arrivalDate", "departureDate");

ALTER TABLE "hospitality_bookings" ADD CONSTRAINT "hospitality_bookings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_bookings" ADD CONSTRAINT "hospitality_bookings_customer_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customers"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_bookings" ADD CONSTRAINT "hospitality_bookings_hold_fkey" FOREIGN KEY ("holdId", "organizationId") REFERENCES "hospitality_availability_holds"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_bookings" ADD CONSTRAINT "hospitality_bookings_room_type_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_bookings" ADD CONSTRAINT "hospitality_bookings_rate_plan_fkey" FOREIGN KEY ("ratePlanId", "propertyId", "organizationId") REFERENCES "hospitality_rate_plans"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_allocations" ADD CONSTRAINT "hospitality_allocations_booking_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_booking_allocations" ADD CONSTRAINT "hospitality_allocations_room_type_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
