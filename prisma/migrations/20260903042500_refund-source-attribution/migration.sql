ALTER TABLE "payment_transactions"
ADD COLUMN "sourceProviderReference" VARCHAR(160);

ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_source_provider_reference_check"
CHECK (
  "sourceProviderReference" IS NULL
  OR (
    "kind" = 'REFUND'
    AND length(btrim("sourceProviderReference")) >= 1
    AND "sourceProviderReference" = btrim("sourceProviderReference")
  )
);

CREATE INDEX "payment_transactions_org_provider_source_reference_idx"
ON "payment_transactions"("organizationId", "providerCode", "sourceProviderReference");
