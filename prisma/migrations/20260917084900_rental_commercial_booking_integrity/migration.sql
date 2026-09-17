-- Strengthen denormalized commercial evidence so every retained booking identifier
-- is independently constrained to the same tenant-owned rental booking. Existing
-- source-authority triggers remain in place; these foreign keys add referential
-- protection even for direct database writes.

ALTER TABLE "rental_damage_liability_decisions"
ADD CONSTRAINT "rental_damage_liability_decisions_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_damage_settlement_transactions"
ADD CONSTRAINT "rental_damage_settlement_transactions_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_damage_settlement_transactions"
ADD CONSTRAINT "rental_damage_settlement_transactions_damage_case_fkey"
FOREIGN KEY ("damageCaseId", "organizationId")
REFERENCES "rental_damage_cases"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_late_return_settlement_transactions"
ADD CONSTRAINT "rental_late_return_settlement_transactions_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
