ALTER TABLE "payment_transactions"
ADD COLUMN "requestFingerprint" CHAR(64);

ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_request_fingerprint_format_check"
CHECK ("requestFingerprint" IS NULL OR "requestFingerprint" ~ '^[0-9a-f]{64}$');
