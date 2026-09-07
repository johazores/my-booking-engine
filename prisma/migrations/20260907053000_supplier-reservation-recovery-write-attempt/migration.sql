-- Add a distinct provider-neutral attempt kind for external recovery writes such as
-- Travelport Booking.com Sync. The operation remains SUBMITTING while the write is
-- in flight; the attempt kind distinguishes it from a fresh supplier sell.
ALTER TYPE "HospitalitySupplierReservationAttemptKind"
ADD VALUE IF NOT EXISTS 'RECOVERY_WRITE';
