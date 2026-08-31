CREATE TABLE "hospitality_booking_guests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL,
    "email" VARCHAR(320),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_booking_guests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_booking_guests_position_check" CHECK ("position" >= 0 AND "position" < 100),
    CONSTRAINT "hospitality_booking_guests_first_name_check" CHECK (length(btrim("firstName")) >= 1 AND "firstName" = btrim("firstName")),
    CONSTRAINT "hospitality_booking_guests_last_name_check" CHECK (length(btrim("lastName")) >= 1 AND "lastName" = btrim("lastName")),
    CONSTRAINT "hospitality_booking_guests_email_check" CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND length("email") >= 3))
);

CREATE UNIQUE INDEX "hospitality_booking_guests_position_key" ON "hospitality_booking_guests"("organizationId", "bookingId", "position");
CREATE INDEX "hospitality_booking_guests_booking_idx" ON "hospitality_booking_guests"("organizationId", "bookingId");
