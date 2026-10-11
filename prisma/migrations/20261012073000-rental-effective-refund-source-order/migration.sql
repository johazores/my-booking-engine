-- Preserve amendment-charge-first source ordering for post-apply refunds.
-- Existing authority trigger holds the shared tenant/booking advisory lock.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "rental_booking_effective_refund_transactions" booking_refund
    JOIN "rental_booking_commercial_amendments" amendment
      ON amendment."id" = booking_refund."amendmentId"
     AND amendment."bookingId" = booking_refund."bookingId"
     AND amendment."organizationId" = booking_refund."organizationId"
    WHERE booking_refund."sourceLedger" = 'BOOKING_PRICE'
      AND amendment."status" = 'APPLIED'
      AND amendment."direction" = 'ADDITIONAL_CHARGE'
      AND COALESCE((
        SELECT SUM(charge_refund."amountMinor")
        FROM "rental_booking_effective_refund_transactions" charge_refund
        WHERE charge_refund."organizationId" = booking_refund."organizationId"
          AND charge_refund."bookingId" = booking_refund."bookingId"
          AND charge_refund."amendmentId" = booking_refund."amendmentId"
          AND charge_refund."sourceLedger" = 'COMMERCIAL_AMENDMENT'
          AND charge_refund."status" = 'SUCCEEDED'
          AND charge_refund."createdAt" <= booking_refund."createdAt"
      ), 0) IS DISTINCT FROM amendment."deltaMinor"
  ) THEN
    RAISE EXCEPTION 'retained rental refunds violate amendment-charge-first source order'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION sf_guard_rental_effective_refund_source_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  amendment_direction "RentalBookingCommercialAmendmentDirection";
  amendment_delta BIGINT;
  refunded_charge_minor NUMERIC;
BEGIN
  IF NEW."sourceLedger" <> 'BOOKING_PRICE' THEN RETURN NEW; END IF;
  SELECT amendment."direction", amendment."deltaMinor"
    INTO amendment_direction, amendment_delta
    FROM "rental_booking_commercial_amendments" amendment
   WHERE amendment."id" = NEW."amendmentId"
     AND amendment."bookingId" = NEW."bookingId"
     AND amendment."organizationId" = NEW."organizationId"
     AND amendment."status" = 'APPLIED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking-price refund requires tenant-owned applied amendment'
      USING ERRCODE = '23514';
  END IF;
  IF amendment_direction = 'ADDITIONAL_CHARGE' THEN
    SELECT COALESCE(SUM(charge_refund."amountMinor"), 0)
      INTO refunded_charge_minor
      FROM "rental_booking_effective_refund_transactions" charge_refund
     WHERE charge_refund."organizationId" = NEW."organizationId"
       AND charge_refund."bookingId" = NEW."bookingId"
       AND charge_refund."amendmentId" = NEW."amendmentId"
       AND charge_refund."sourceLedger" = 'COMMERCIAL_AMENDMENT'
       AND charge_refund."status" = 'SUCCEEDED';
    IF refunded_charge_minor IS DISTINCT FROM amendment_delta THEN
      RAISE EXCEPTION 'booking-price refund requires full amendment-charge refund first'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger names execute alphabetically: authority_guard takes the booking
-- lock before the source-order guard checks already-retained refunds.
CREATE TRIGGER rental_effective_refund_source_order_guard
BEFORE INSERT ON "rental_booking_effective_refund_transactions"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_effective_refund_source_order();
