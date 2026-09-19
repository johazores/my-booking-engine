CREATE OR REPLACE FUNCTION sf_guard_rental_payment_after_commercial_amendment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
      0
    ));

    IF EXISTS (
      SELECT 1
        FROM "rental_booking_commercial_amendments" amendment
       WHERE amendment."organizationId" = NEW."organizationId"
         AND amendment."bookingId" = NEW."bookingId"
         AND amendment."status" IN ('PREPARED', 'APPLIED')
    ) THEN
      RAISE EXCEPTION 'original booking-price settlement is frozen while a rental commercial amendment is prepared or applied'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
