CREATE OR REPLACE FUNCTION sf_assert_rental_booking_cancellation_evidence(
  p_organization_id uuid,
  p_booking_resource_id text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id uuid;
  v_booking_status text;
  v_cancelled_at timestamptz;
  v_audit_count bigint;
  v_after_data jsonb;
  v_allocation_id uuid;
  v_reason text;
BEGIN
  SELECT booking."id", booking."status"::text, booking."cancelledAt"
    INTO v_booking_id, v_booking_status, v_cancelled_at
    FROM "rental_bookings" booking
   WHERE booking."organizationId" = p_organization_id
     AND booking."id"::text = p_booking_resource_id;

  SELECT COUNT(*)
    INTO v_audit_count
    FROM "audit_events" audit
   WHERE audit."organizationId" = p_organization_id
     AND audit."action" = 'booking.rental.cancelled'
     AND audit."resourceType" = 'rental-booking'
     AND audit."resourceId" = p_booking_resource_id;

  IF v_booking_id IS NULL THEN
    IF v_audit_count <> 0 THEN
      RAISE EXCEPTION 'rental cancellation audit evidence cannot outlive its tenant booking';
    END IF;
    RETURN;
  END IF;

  IF v_booking_status <> 'CANCELLED' THEN
    IF v_audit_count <> 0 THEN
      RAISE EXCEPTION 'non-cancelled rental booking cannot retain cancellation audit evidence';
    END IF;
    RETURN;
  END IF;

  IF v_cancelled_at IS NULL THEN
    RAISE EXCEPTION 'cancelled rental booking is missing cancelledAt evidence';
  END IF;

  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'cancelled rental booking must retain exactly one cancellation audit event';
  END IF;

  SELECT audit."afterData"
    INTO v_after_data
    FROM "audit_events" audit
   WHERE audit."organizationId" = p_organization_id
     AND audit."action" = 'booking.rental.cancelled'
     AND audit."resourceType" = 'rental-booking'
     AND audit."resourceId" = p_booking_resource_id;

  IF jsonb_typeof(v_after_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'rental cancellation audit afterData must be an object';
  END IF;

  IF jsonb_typeof(v_after_data -> 'status') IS DISTINCT FROM 'string'
     OR v_after_data ->> 'status' <> 'CANCELLED' THEN
    RAISE EXCEPTION 'rental cancellation audit status does not match terminal booking state';
  END IF;

  IF jsonb_typeof(v_after_data -> 'inventoryProtectionReleased') IS DISTINCT FROM 'boolean'
     OR v_after_data ->> 'inventoryProtectionReleased' <> 'true' THEN
    RAISE EXCEPTION 'rental cancellation audit must retain released inventory protection evidence';
  END IF;

  IF jsonb_typeof(v_after_data -> 'cancellationReason') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'rental cancellation audit reason must be retained as a string';
  END IF;
  v_reason := v_after_data ->> 'cancellationReason';
  IF char_length(v_reason) = 0
     OR char_length(v_reason) > 1000
     OR v_reason <> regexp_replace(btrim(v_reason), '[[:space:]]+', ' ', 'g') THEN
    RAISE EXCEPTION 'rental cancellation audit reason is not in canonical retained form';
  END IF;

  IF jsonb_typeof(v_after_data -> 'cancelledAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'rental cancellation audit timestamp must be retained as a string';
  END IF;
  IF (v_after_data ->> 'cancelledAt')::timestamptz IS DISTINCT FROM v_cancelled_at THEN
    RAISE EXCEPTION 'rental cancellation audit timestamp does not match booking cancelledAt';
  END IF;

  SELECT allocation."id"
    INTO v_allocation_id
    FROM "rental_booking_allocations" allocation
   WHERE allocation."organizationId" = p_organization_id
     AND allocation."bookingId" = v_booking_id;
  IF v_allocation_id IS NULL THEN
    RAISE EXCEPTION 'cancelled rental booking is missing retained allocation evidence';
  END IF;

  IF jsonb_typeof(v_after_data -> 'allocationId') IS DISTINCT FROM 'string'
     OR v_after_data ->> 'allocationId' <> v_allocation_id::text THEN
    RAISE EXCEPTION 'rental cancellation audit allocation does not match retained booking allocation';
  END IF;
END;
$$;

DO $$
DECLARE
  evidence record;
BEGIN
  FOR evidence IN
    SELECT scope."organizationId", scope."resourceId"
      FROM (
        SELECT booking."organizationId", booking."id"::text AS "resourceId"
          FROM "rental_bookings" booking
         WHERE booking."status" = 'CANCELLED'
        UNION
        SELECT audit."organizationId", audit."resourceId"
          FROM "audit_events" audit
         WHERE audit."action" = 'booking.rental.cancelled'
           AND audit."resourceType" = 'rental-booking'
      ) scope
  LOOP
    PERFORM sf_assert_rental_booking_cancellation_evidence(
      evidence."organizationId",
      evidence."resourceId"
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sf_enforce_rental_booking_cancellation_evidence_from_booking()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM sf_assert_rental_booking_cancellation_evidence(
      OLD."organizationId",
      OLD."id"::text
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM sf_assert_rental_booking_cancellation_evidence(
      NEW."organizationId",
      NEW."id"::text
    );
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION sf_enforce_rental_booking_cancellation_evidence_from_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD."action" = 'booking.rental.cancelled'
     AND OLD."resourceType" = 'rental-booking' THEN
    PERFORM sf_assert_rental_booking_cancellation_evidence(
      OLD."organizationId",
      OLD."resourceId"
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW."action" = 'booking.rental.cancelled'
     AND NEW."resourceType" = 'rental-booking' THEN
    PERFORM sf_assert_rental_booking_cancellation_evidence(
      NEW."organizationId",
      NEW."resourceId"
    );
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_booking_cancellation_evidence_booking_guard
AFTER INSERT OR UPDATE OR DELETE ON "rental_bookings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_enforce_rental_booking_cancellation_evidence_from_booking();

CREATE CONSTRAINT TRIGGER rental_booking_cancellation_evidence_audit_guard
AFTER INSERT OR UPDATE OR DELETE ON "audit_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_enforce_rental_booking_cancellation_evidence_from_audit();
