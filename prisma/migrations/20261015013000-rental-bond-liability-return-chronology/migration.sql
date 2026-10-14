-- Add an independent physical backstop without rewriting applied migration history.
-- The existing authority trigger continues to enforce the complete forfeiture contract.
CREATE FUNCTION sf_guard_rental_bond_liability_return_chronology()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM "rental_damage_liability_decisions" liability
          JOIN "rental_booking_fulfillment_events" returned
            ON returned."organizationId" = liability."organizationId"
           AND returned."bookingId" = liability."bookingId"
           AND returned."unitId" = liability."unitId"
           AND returned."kind" = 'RETURNED'
           AND returned."occurredAt" <= liability."decidedAt"
         WHERE liability."organizationId" = NEW."organizationId"
           AND liability."bookingId" = NEW."bookingId"
           AND liability."id" = NEW."liabilityDecisionId"
           AND liability."outcome" = 'CUSTOMER_LIABLE'
    ) THEN
        RAISE EXCEPTION 'rental security bond forfeiture requires return custody before customer damage liability decision'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$;

-- Trigger names sort after the existing forfeiture authority trigger, which
-- retains the advisory locks, exact-match validation, and database clock.
CREATE TRIGGER rental_security_bond_forfeitures_chronology_guard
BEFORE INSERT ON "rental_security_bond_forfeitures"
FOR EACH ROW EXECUTE FUNCTION sf_guard_rental_bond_liability_return_chronology();
