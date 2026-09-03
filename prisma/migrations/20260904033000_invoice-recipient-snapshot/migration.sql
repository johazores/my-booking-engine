ALTER TABLE "hospitality_invoice_preparations"
  ADD COLUMN "recipientFingerprint" CHAR(64);

ALTER TABLE "hospitality_invoice_preparations"
  DROP CONSTRAINT "hospitality_invoice_preparations_key_check";
ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_key_check"
  CHECK ("preparationKey" ~ '^invoice-preparation:v(1|2):[a-f0-9]{64}$');

ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_recipient_fingerprint_check"
  CHECK ("recipientFingerprint" IS NULL OR "recipientFingerprint" ~ '^[a-f0-9]{64}$');

ALTER TABLE "hospitality_invoice_preparations"
  DROP CONSTRAINT "hospitality_invoice_preparations_snapshot_check";
ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_snapshot_check" CHECK (
    jsonb_typeof("preparationSnapshot") = 'object'
    AND "preparationSnapshot"->>'kind' = 'INVOICE'
    AND "preparationSnapshot"->>'pricingEvidenceId' = "pricingEvidenceId"::text
    AND "preparationSnapshot"->>'issuerProfileId' = "issuerProfileId"::text
    AND "preparationSnapshot"->>'currency' = "currency"
    AND "preparationSnapshot"->>'accommodationSubtotalMinor' = "accommodationSubtotalMinor"::text
    AND "preparationSnapshot"->>'taxTotalMinor' = "taxTotalMinor"::text
    AND "preparationSnapshot"->>'feeTotalMinor' = "feeTotalMinor"::text
    AND "preparationSnapshot"->>'addonTotalMinor' = "addonTotalMinor"::text
    AND "preparationSnapshot"->>'totalMinor' = "totalMinor"::text
    AND "preparationSnapshot"->>'pricingFingerprint' = "pricingFingerprint"
    AND "preparationSnapshot"->>'issuerFingerprint' = "issuerFingerprint"
    AND (
      (
        "preparationSnapshot"->>'schemaVersion' = '1'
        AND "recipientFingerprint" IS NULL
      )
      OR (
        "preparationSnapshot"->>'schemaVersion' = '2'
        AND "recipientFingerprint" IS NOT NULL
        AND "preparationSnapshot"->>'recipientFingerprint' = "recipientFingerprint"
        AND jsonb_typeof("preparationSnapshot"->'recipient') = 'object'
        AND "preparationSnapshot"->'recipient'->>'schemaVersion' = '1'
        AND "preparationSnapshot"->'recipient'->>'recipientType' IN ('INDIVIDUAL', 'BUSINESS')
        AND length(trim(COALESCE("preparationSnapshot"->'recipient'->>'legalName', ''))) >= 1
        AND jsonb_typeof("preparationSnapshot"->'recipient'->'registrations') = 'array'
      )
    )
  );
