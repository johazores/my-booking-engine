-- Bind retained security-bond evidence to the same tenant-owned rental booking
-- at the database relation layer, in addition to the existing authority triggers.
ALTER TABLE "rental_security_bond_requirements"
  ADD CONSTRAINT "rental_security_bond_requirements_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId")
  REFERENCES "rental_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_security_bond_transactions"
  ADD CONSTRAINT "rental_security_bond_transactions_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId")
  REFERENCES "rental_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
