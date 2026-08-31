ALTER TABLE "hospitality_booking_guests"
ADD CONSTRAINT "hospitality_booking_guests_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "hospitality_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
