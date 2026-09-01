DROP INDEX "payment_transactions_org_provider_reference_key";

CREATE UNIQUE INDEX "payment_transactions_org_provider_reference_kind_key"
ON "payment_transactions"("organizationId", "providerCode", "providerReference", "kind");

CREATE INDEX "payment_transactions_org_provider_reference_idx"
ON "payment_transactions"("organizationId", "providerCode", "providerReference");
