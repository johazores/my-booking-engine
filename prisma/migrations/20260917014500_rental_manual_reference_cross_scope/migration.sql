CREATE FUNCTION sf_guard_rental_manual_reference_cross_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."providerCode" <> 'manual' THEN
        RETURN NEW;
    END IF;

    -- A real-world manual payment/refund reference must identify only one
    -- tenant settlement row across booking-price and damage-liability ledgers.
    -- The shared advisory lock closes the race where one row is inserted into
    -- each table concurrently before either cross-table check can observe it.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-manual-reference:' || NEW."organizationId"::text || ':' || NEW."providerReference",
            0
        )
    );

    IF TG_TABLE_NAME = 'rental_payment_transactions' THEN
        IF EXISTS (
            SELECT 1
              FROM "rental_damage_settlement_transactions" damage_payment
             WHERE damage_payment."organizationId" = NEW."organizationId"
               AND damage_payment."providerCode" = NEW."providerCode"
               AND damage_payment."providerReference" = NEW."providerReference"
        ) THEN
            RAISE EXCEPTION 'manual rental provider reference is already retained as damage settlement evidence in this tenant'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'rental_damage_settlement_transactions' THEN
        IF EXISTS (
            SELECT 1
              FROM "rental_payment_transactions" booking_payment
             WHERE booking_payment."organizationId" = NEW."organizationId"
               AND booking_payment."providerCode" = NEW."providerCode"
               AND booking_payment."providerReference" = NEW."providerReference"
        ) THEN
            RAISE EXCEPTION 'manual rental provider reference is already retained as booking settlement evidence in this tenant'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'manual rental provider reference guard is attached to an unexpected table'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_payment_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_payment_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();

CREATE TRIGGER rental_damage_settlement_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_damage_settlement_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();
