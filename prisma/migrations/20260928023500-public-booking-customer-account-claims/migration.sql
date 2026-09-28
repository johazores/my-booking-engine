ALTER TABLE "public_booking_principals"
ADD COLUMN "claimedByUserId" UUID,
ADD COLUMN "claimedAt" TIMESTAMPTZ(6);

ALTER TABLE "public_booking_principals"
ADD CONSTRAINT "public_booking_principal_claim_pair_check"
CHECK (
  ("claimedByUserId" IS NULL AND "claimedAt" IS NULL)
  OR ("claimedByUserId" IS NOT NULL AND "claimedAt" IS NOT NULL)
);

ALTER TABLE "public_booking_principals"
ADD CONSTRAINT "public_booking_principal_claimed_user_fkey"
FOREIGN KEY ("claimedByUserId")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "public_booking_principals_claimed_user_idx"
ON "public_booking_principals"("organizationId", "claimedByUserId", "claimedAt");
