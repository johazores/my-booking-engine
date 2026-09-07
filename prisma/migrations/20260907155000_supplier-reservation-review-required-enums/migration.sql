-- Preserve Travelport price/guarantee sell-change outcomes as an explicit durable review state
-- instead of collapsing them into generic failure. No acceptance or second supplier write is
-- enabled by these enum additions.
ALTER TYPE "HospitalitySupplierReservationOperationStatus"
ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

ALTER TYPE "HospitalitySupplierReservationAttemptStatus"
ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';
