-- Normalize PostgreSQL-truncated names created by the hospitality commercial-amendment foundation.
-- The rename sources below are the exact 63-byte identifiers PostgreSQL stores.
ALTER TABLE "hospitality_booking_commercial_amendments"
  RENAME CONSTRAINT "hospitality_booking_commercial_amendments_current_room_type_fke"
  TO "hospitality_commercial_amendments_current_room_type_fkey";

ALTER TABLE "hospitality_booking_commercial_amendments"
  RENAME CONSTRAINT "hospitality_booking_commercial_amendments_current_rate_plan_fke"
  TO "hospitality_commercial_amendments_current_rate_plan_fkey";

ALTER INDEX "hospitality_booking_commercial_amendments_org_booking_status_ex"
  RENAME TO "hospitality_commercial_amendments_booking_status_expiry_idx";
