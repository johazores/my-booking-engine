ALTER TABLE "organizations"
  ADD COLUMN "logoUrl" VARCHAR(2048),
  ADD COLUMN "faviconUrl" VARCHAR(2048),
  ADD COLUMN "primaryColor" CHAR(7) NOT NULL DEFAULT '#2563eb',
  ADD COLUMN "secondaryColor" CHAR(7) NOT NULL DEFAULT '#0d1626',
  ADD COLUMN "accentColor" CHAR(7) NOT NULL DEFAULT '#20c997',
  ADD COLUMN "fontFamily" VARCHAR(20) NOT NULL DEFAULT 'INTER',
  ADD COLUMN "contactEmail" VARCHAR(320),
  ADD COLUMN "contactPhone" VARCHAR(40),
  ADD COLUMN "websiteUrl" VARCHAR(2048),
  ADD COLUMN "emailFromName" VARCHAR(160),
  ADD COLUMN "emailReplyTo" VARCHAR(320),
  ADD COLUMN "publicBookingTitle" VARCHAR(160),
  ADD COLUMN "publicBookingDescription" VARCHAR(500),
  ADD COLUMN "customDomain" VARCHAR(253);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_primary_color_hex" CHECK ("primaryColor" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "organizations_secondary_color_hex" CHECK ("secondaryColor" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "organizations_accent_color_hex" CHECK ("accentColor" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "organizations_font_family_supported" CHECK ("fontFamily" IN ('INTER', 'SYSTEM', 'SERIF', 'MONO')),
  ADD CONSTRAINT "organizations_contact_email_canonical" CHECK ("contactEmail" IS NULL OR "contactEmail" = lower(btrim("contactEmail"))),
  ADD CONSTRAINT "organizations_email_reply_to_canonical" CHECK ("emailReplyTo" IS NULL OR "emailReplyTo" = lower(btrim("emailReplyTo"))),
  ADD CONSTRAINT "organizations_custom_domain_canonical" CHECK ("customDomain" IS NULL OR "customDomain" = lower(btrim("customDomain")));

CREATE UNIQUE INDEX "organizations_customDomain_key" ON "organizations"("customDomain");
