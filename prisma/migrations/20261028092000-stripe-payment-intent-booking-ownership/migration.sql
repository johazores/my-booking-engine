-- A Stripe PaymentIntent is owned by one booking within one tenant. AUTHORIZATION
-- and CAPTURE rows may legitimately share the same pi_* identity on that booking.
-- This guard covers every payment kind, amendment, and status, including history.
-- It must also reject concurrent writers that do not share application advisory locks.
--
-- The btree_gist extension is trusted, but deployment needs CREATE privilege on
-- the database. Review the exclusive table lock required for ADD CONSTRAINT.

-- Refuse conflicting historical evidence; do not silently reassign payments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payment_transactions"
    WHERE "providerCode" = 'stripe'
      AND left("providerReference", 3) = 'pi_'
    GROUP BY "organizationId", "providerReference"
    HAVING count(DISTINCT "bookingId") > 1
  ) THEN
    RAISE EXCEPTION 'Conflicting Stripe PaymentIntent booking ownership exists; reconcile historical evidence before applying this migration'
      USING ERRCODE = '23P01';
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Unlike a unique index, this exclusion constraint permits multiple rows with
-- the same pi_* reference on one booking while rejecting a different booking.
ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_stripe_pi_booking_excl"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "providerReference" WITH =,
    "bookingId" WITH <>
  )
  WHERE ("providerCode" = 'stripe' AND left("providerReference", 3) = 'pi_');
