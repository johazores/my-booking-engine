-- Normalize the legacy PostgreSQL-truncated rental commercial-amendment lookup index.
-- Rename the exact stored 63-byte name without rebuilding the index or changing its columns.
ALTER INDEX "rental_booking_commercial_amendments_org_booking_status_expiry_"
  RENAME TO "rental_comm_amend_org_booking_status_expiry_idx";
