-- A real Stripe PaymentIntent belongs to one commercial scope within a booking.
-- Authorization and capture rows may share it within the same base-booking or
-- amendment scope, but not between base and amendment or two amendments.
-- The earlier cross-booking exclusion constraint remains independently required.
-- NULL amendment attribution uses a non-UUID text sentinel, avoiding UUID collision.
-- btree_gist is installed by the preceding booking-ownership migration.

-- Reject historical mixed-scope evidence without rewriting financial history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payment_transactions"
    WHERE "providerCode" = 'stripe'
      AND left("providerReference", 3) = 'pi_'
    GROUP BY "organizationId", "bookingId", "providerReference"
    HAVING count(DISTINCT coalesce("commercialAmendmentId"::text, 'base-booking')) > 1
  ) THEN
    RAISE EXCEPTION 'Conflicting Stripe PaymentIntent amendment ownership exists; reconcile historical evidence before applying this migration'
      USING ERRCODE = '23P01';
  END IF;
END
$$;

-- An exclusion constraint permits same-scope authorization/capture sharing while
-- rejecting cross-scope inserts, claim binding, reassignment, and concurrent writes.
ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_stripe_pi_amendment_excl"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "bookingId" WITH =,
    "providerReference" WITH =,
    (coalesce("commercialAmendmentId"::text, 'base-booking')) WITH <>
  )
  WHERE ("providerCode" = 'stripe' AND left("providerReference", 3) = 'pi_');
