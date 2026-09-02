CREATE TABLE "public_booking_booking_ownership" (
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "principalId" UUID NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_booking_booking_ownership_pkey" PRIMARY KEY ("organizationId", "bookingId"),
    CONSTRAINT "public_booking_booking_request_fingerprint_check" CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "public_booking_booking_owner_principal_idx" ON "public_booking_booking_ownership"("organizationId", "principalId");

ALTER TABLE "public_booking_booking_ownership"
  ADD CONSTRAINT "public_booking_booking_owner_principal_fkey"
  FOREIGN KEY ("principalId", "organizationId") REFERENCES "public_booking_principals"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public_booking_booking_ownership"
  ADD CONSTRAINT "public_booking_booking_owner_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
