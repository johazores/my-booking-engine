CREATE FUNCTION sf_author_rental_booking_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."updatedAt" := GREATEST(
        clock_timestamp(),
        OLD."updatedAt" + INTERVAL '1 microsecond'
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_version_clock_authority
BEFORE UPDATE ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_booking_version();
