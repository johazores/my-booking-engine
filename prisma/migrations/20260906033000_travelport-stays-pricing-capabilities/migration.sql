-- Keep current Travelport Stays integration metadata aligned with the capabilities
-- now implemented by the adapter without rewriting archived capability history.
UPDATE "integrations"
SET
  "capabilities" = ARRAY['availability', 'hotel-search', 'pricing']::TEXT[],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "providerCode" = 'travelport-stays'
  AND "status" IN ('ACTIVE', 'DISABLED')
  AND "capabilities" IS DISTINCT FROM ARRAY['availability', 'hotel-search', 'pricing']::TEXT[];
