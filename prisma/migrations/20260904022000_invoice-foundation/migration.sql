CREATE TABLE "invoice_issuer_profiles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "profileSnapshot" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_issuer_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_issuer_profiles_version_check" CHECK ("version" >= 1),
    CONSTRAINT "invoice_issuer_profiles_fingerprint_check" CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "invoice_issuer_profiles_country_check" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
    CONSTRAINT "invoice_issuer_profiles_snapshot_check" CHECK (
      jsonb_typeof("profileSnapshot") = 'object'
      AND "profileSnapshot"->>'schemaVersion' = '1'
      AND "profileSnapshot"->>'countryCode' = "countryCode"
      AND length(trim(COALESCE("profileSnapshot"->>'legalName', ''))) >= 1
      AND jsonb_typeof("profileSnapshot"->'registrations') = 'array'
    )
);

CREATE UNIQUE INDEX "invoice_issuer_profiles_id_org_key"
  ON "invoice_issuer_profiles"("id", "organizationId");
CREATE UNIQUE INDEX "invoice_issuer_profiles_org_version_key"
  ON "invoice_issuer_profiles"("organizationId", "version");
CREATE INDEX "invoice_issuer_profiles_org_created_idx"
  ON "invoice_issuer_profiles"("organizationId", "createdAt");

ALTER TABLE "invoice_issuer_profiles"
  ADD CONSTRAINT "invoice_issuer_profiles_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_issuer_profiles"
  ADD CONSTRAINT "invoice_issuer_profiles_created_by_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "hospitality_booking_pricing_evidence_id_booking_org_key"
  ON "hospitality_booking_pricing_evidence"("id", "bookingId", "organizationId");

CREATE TABLE "hospitality_invoice_preparations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "pricingEvidenceId" UUID NOT NULL,
    "issuerProfileId" UUID NOT NULL,
    "preparationKey" VARCHAR(220) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "accommodationSubtotalMinor" BIGINT NOT NULL,
    "taxTotalMinor" BIGINT NOT NULL,
    "feeTotalMinor" BIGINT NOT NULL,
    "addonTotalMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "pricingFingerprint" CHAR(64) NOT NULL,
    "issuerFingerprint" CHAR(64) NOT NULL,
    "documentFingerprint" CHAR(64) NOT NULL,
    "preparationSnapshot" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_invoice_preparations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_invoice_preparations_key_check" CHECK ("preparationKey" ~ '^invoice-preparation:v1:[a-f0-9]{64}$'),
    CONSTRAINT "hospitality_invoice_preparations_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "hospitality_invoice_preparations_pricing_fingerprint_check" CHECK ("pricingFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "hospitality_invoice_preparations_issuer_fingerprint_check" CHECK ("issuerFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "hospitality_invoice_preparations_document_fingerprint_check" CHECK ("documentFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "hospitality_invoice_preparations_money_check" CHECK (
      "accommodationSubtotalMinor" >= 0
      AND "taxTotalMinor" >= 0
      AND "feeTotalMinor" >= 0
      AND "addonTotalMinor" >= 0
      AND "totalMinor" = "accommodationSubtotalMinor" + "taxTotalMinor" + "feeTotalMinor" + "addonTotalMinor"
    ),
    CONSTRAINT "hospitality_invoice_preparations_snapshot_check" CHECK (
      jsonb_typeof("preparationSnapshot") = 'object'
      AND "preparationSnapshot"->>'schemaVersion' = '1'
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
    )
);

CREATE UNIQUE INDEX "hospitality_invoice_preparations_id_org_key"
  ON "hospitality_invoice_preparations"("id", "organizationId");
CREATE UNIQUE INDEX "hospitality_invoice_preparations_org_key"
  ON "hospitality_invoice_preparations"("organizationId", "preparationKey");
CREATE UNIQUE INDEX "hospitality_invoice_preparations_org_fingerprint_key"
  ON "hospitality_invoice_preparations"("organizationId", "documentFingerprint");
CREATE INDEX "hospitality_invoice_preparations_org_booking_created_idx"
  ON "hospitality_invoice_preparations"("organizationId", "bookingId", "createdAt");
CREATE INDEX "hospitality_invoice_preparations_org_issuer_created_idx"
  ON "hospitality_invoice_preparations"("organizationId", "issuerProfileId", "createdAt");

ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_pricing_evidence_fkey"
  FOREIGN KEY ("pricingEvidenceId", "bookingId", "organizationId")
  REFERENCES "hospitality_booking_pricing_evidence"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_issuer_profile_fkey"
  FOREIGN KEY ("issuerProfileId", "organizationId") REFERENCES "invoice_issuer_profiles"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_invoice_preparations"
  ADD CONSTRAINT "hospitality_invoice_preparations_created_by_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
