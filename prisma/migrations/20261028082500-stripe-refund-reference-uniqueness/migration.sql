-- A Stripe Refund ID represents one provider money movement. The same real re_* reference
-- must never be bound to two payment transactions in one tenant, including across bookings,
-- commercial amendments, operation kinds, or historical terminal statuses.
-- Authorization and capture may legitimately share a pi_* PaymentIntent, so do not
-- make all Stripe provider references globally unique.

-- Fail closed on pre-existing duplicate evidence without rewriting commercial history.
-- Resolve duplicates using verified provider truth and a reviewed repair plan before retrying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payment_transactions"
    WHERE "providerCode" = 'stripe'
      AND left("providerReference", 3) = 're_'
    GROUP BY "organizationId", "providerReference"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Stripe Refund references exist within a tenant; reconcile historical payment evidence before applying this migration'
      USING ERRCODE = '23505';
  END IF;
END
$$;

-- A partial unique index is required: ordinary AUTHORIZATION/CAPTURE rows can share pi_*.
-- Keep this raw PostgreSQL authority in the checked-in migration, not a broad Prisma @@unique.
CREATE UNIQUE INDEX "payment_transactions_stripe_refund_ref_key"
  ON "payment_transactions"("organizationId", "providerReference")
  WHERE "providerCode" = 'stripe'
    AND left("providerReference", 3) = 're_';
