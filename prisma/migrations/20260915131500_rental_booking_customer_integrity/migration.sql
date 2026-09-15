ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_customer_fkey"
FOREIGN KEY ("customerId", "organizationId")
REFERENCES "customers"("id", "organizationId")
ON DELETE RESTRICT
ON UPDATE CASCADE;
