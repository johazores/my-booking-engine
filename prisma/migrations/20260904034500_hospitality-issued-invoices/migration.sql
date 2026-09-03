CREATE UNIQUE INDEX "hospitality_invoice_preparations_id_booking_org_key"
  ON "hospitality_invoice_preparations"("id", "bookingId", "organizationId");

CREATE TABLE "hospitality_invoice_number_sequences" (
    "organizationId" UUID NOT NULL,
    "jurisdictionCode" VARCHAR(16) NOT NULL,
    "documentType" VARCHAR(32) NOT NULL,
    "nextValue" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "hospitality_invoice_number_sequences_pkey"
      PRIMARY KEY ("organizationId", "jurisdictionCode", "documentType"),
    CONSTRAINT "hospitality_invoice_number_sequences_jurisdiction_check"
      CHECK ("jurisdictionCode" ~ '^[A-Z][A-Z0-9_-]{1,15}$'),
    CONSTRAINT "hospitality_invoice_number_sequences_document_type_check"
      CHECK ("documentType" ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    CONSTRAINT "hospitality_invoice_number_sequences_next_value_check"
      CHECK ("nextValue" >= 1)
);

ALTER TABLE "hospitality_invoice_number_sequences"
  ADD CONSTRAINT "hospitality_invoice_number_sequences_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "hospitality_issued_invoices" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "preparationId" UUID NOT NULL,
    "pricingEvidenceId" UUID NOT NULL,
    "issuerProfileId" UUID NOT NULL,
    "jurisdictionCode" VARCHAR(16) NOT NULL,
    "documentType" VARCHAR(32) NOT NULL,
    "documentNumber" VARCHAR(64) NOT NULL,
    "sequenceValue" BIGINT NOT NULL,
    "issuedByUserId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "accommodationSubtotalMinor" BIGINT NOT NULL,
    "taxTotalMinor" BIGINT NOT NULL,
    "feeTotalMinor" BIGINT NOT NULL,
    "addonTotalMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "preparationFingerprint" CHAR(64) NOT NULL,
    "pricingFingerprint" CHAR(64) NOT NULL,
    "issuerFingerprint" CHAR(64) NOT NULL,
    "recipientFingerprint" CHAR(64) NOT NULL,
    "documentFingerprint" CHAR(64) NOT NULL,
    "documentSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hospitality_issued_invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_issued_invoices_contract_check" CHECK (
      "jurisdictionCode" = 'AU'
      AND "documentType" = 'TAX_INVOICE'
      AND "documentNumber" ~ '^AU-TAX-[0-9]{8,}$'
      AND "sequenceValue" >= 1
    ),
    CONSTRAINT "hospitality_issued_invoices_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "hospitality_issued_invoices_money_check" CHECK (
      "accommodationSubtotalMinor" >= 0
      AND "taxTotalMinor" >= 0
      AND "feeTotalMinor" >= 0
      AND "addonTotalMinor" >= 0
      AND "totalMinor" = "accommodationSubtotalMinor" + "taxTotalMinor" + "feeTotalMinor" + "addonTotalMinor"
    ),
    CONSTRAINT "hospitality_issued_invoices_fingerprint_check" CHECK (
      "preparationFingerprint" ~ '^[a-f0-9]{64}$'
      AND "pricingFingerprint" ~ '^[a-f0-9]{64}$'
      AND "issuerFingerprint" ~ '^[a-f0-9]{64}$'
      AND "recipientFingerprint" ~ '^[a-f0-9]{64}$'
      AND "documentFingerprint" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "hospitality_issued_invoices_snapshot_check" CHECK (
      jsonb_typeof("documentSnapshot") = 'object'
      AND "documentSnapshot"->>'schemaVersion' = '1'
      AND "documentSnapshot"->>'kind' = 'TAX_INVOICE'
      AND "documentSnapshot"->>'jurisdictionCode' = "jurisdictionCode"
      AND "documentSnapshot"->>'organizationId' = "organizationId"::text
      AND "documentSnapshot"->>'bookingId' = "bookingId"::text
      AND "documentSnapshot"->>'preparationId' = "preparationId"::text
      AND "documentSnapshot"->>'pricingEvidenceId' = "pricingEvidenceId"::text
      AND "documentSnapshot"->>'issuerProfileId' = "issuerProfileId"::text
      AND "documentSnapshot"->>'documentNumber' = "documentNumber"
      AND "documentSnapshot"->>'sequenceValue' = "sequenceValue"::text
      AND "documentSnapshot"->>'currency' = "currency"
      AND "documentSnapshot"->>'accommodationSubtotalMinor' = "accommodationSubtotalMinor"::text
      AND "documentSnapshot"->>'taxTotalMinor' = "taxTotalMinor"::text
      AND "documentSnapshot"->>'feeTotalMinor' = "feeTotalMinor"::text
      AND "documentSnapshot"->>'addonTotalMinor' = "addonTotalMinor"::text
      AND "documentSnapshot"->>'totalMinor' = "totalMinor"::text
      AND "documentSnapshot"->>'preparationFingerprint' = "preparationFingerprint"
      AND "documentSnapshot"->>'pricingFingerprint' = "pricingFingerprint"
      AND "documentSnapshot"->>'issuerFingerprint' = "issuerFingerprint"
      AND "documentSnapshot"->>'recipientFingerprint' = "recipientFingerprint"
      AND jsonb_typeof("documentSnapshot"->'issuer') = 'object'
      AND jsonb_typeof("documentSnapshot"->'recipient') = 'object'
      AND jsonb_typeof("documentSnapshot"->'pricing') = 'object'
      AND jsonb_typeof("documentSnapshot"->'australianTax') = 'object'
      AND "documentSnapshot"->'australianTax'->>'documentLabel' = 'Tax invoice'
    )
);

CREATE UNIQUE INDEX "hospitality_issued_invoices_id_org_key"
  ON "hospitality_issued_invoices"("id", "organizationId");
CREATE UNIQUE INDEX "hospitality_issued_invoices_org_preparation_key"
  ON "hospitality_issued_invoices"("organizationId", "preparationId");
CREATE UNIQUE INDEX "hospitality_issued_invoices_org_jurisdiction_number_key"
  ON "hospitality_issued_invoices"("organizationId", "jurisdictionCode", "documentNumber");
CREATE UNIQUE INDEX "hospitality_issued_invoices_org_jurisdiction_type_sequence_key"
  ON "hospitality_issued_invoices"("organizationId", "jurisdictionCode", "documentType", "sequenceValue");
CREATE UNIQUE INDEX "hospitality_issued_invoices_org_fingerprint_key"
  ON "hospitality_issued_invoices"("organizationId", "documentFingerprint");
CREATE INDEX "hospitality_issued_invoices_org_booking_issued_idx"
  ON "hospitality_issued_invoices"("organizationId", "bookingId", "issuedAt");
CREATE INDEX "hospitality_issued_invoices_org_issuer_issued_idx"
  ON "hospitality_issued_invoices"("organizationId", "issuerProfileId", "issuedAt");

ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_preparation_fkey"
  FOREIGN KEY ("preparationId", "bookingId", "organizationId")
  REFERENCES "hospitality_invoice_preparations"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_pricing_evidence_fkey"
  FOREIGN KEY ("pricingEvidenceId", "bookingId", "organizationId")
  REFERENCES "hospitality_booking_pricing_evidence"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_issuer_profile_fkey"
  FOREIGN KEY ("issuerProfileId", "organizationId") REFERENCES "invoice_issuer_profiles"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitality_issued_invoices"
  ADD CONSTRAINT "hospitality_issued_invoices_issued_by_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
