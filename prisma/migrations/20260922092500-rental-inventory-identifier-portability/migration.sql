-- Normalize PostgreSQL-truncated names created by the rental inventory and hold foundations.
-- The rename sources below are the exact 63-byte identifiers PostgreSQL stores.
ALTER INDEX "rental_availability_blocks_organizationId_unitId_startsOn_endsO"
  RENAME TO "rental_availability_blocks_unit_dates_idx";

ALTER INDEX "rental_rate_periods_organizationId_unitTypeId_startsOn_endsOn_i"
  RENAME TO "rental_rate_periods_unit_type_dates_idx";

ALTER INDEX "rental_availability_holds_organizationId_unitId_status_startsOn"
  RENAME TO "rental_availability_holds_unit_status_dates_idx";
