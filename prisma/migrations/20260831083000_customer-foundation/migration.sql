CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "customers" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "firstName" VARCHAR(80) NOT NULL,
  "lastName" VARCHAR(80) NOT NULL,
  "email" VARCHAR(320),
  "phone" VARCHAR(40),
  "notes" TEXT,
  "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "archivedAt" TIMESTAMPTZ(6),

  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_first_name_not_blank" CHECK ("firstName" = btrim("firstName") AND char_length("firstName") > 0),
  CONSTRAINT "customers_last_name_not_blank" CHECK ("lastName" = btrim("lastName") AND char_length("lastName") > 0),
  CONSTRAINT "customers_email_canonical" CHECK ("email" IS NULL OR "email" = lower(btrim("email"))),
  CONSTRAINT "customers_archive_state_consistent" CHECK (
    ("status" = 'ACTIVE' AND "archivedAt" IS NULL) OR
    ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "customers_organizationId_email_key" ON "customers"("organizationId", "email");
CREATE INDEX "customers_organizationId_status_createdAt_idx" ON "customers"("organizationId", "status", "createdAt");
CREATE INDEX "customers_organizationId_lastName_firstName_idx" ON "customers"("organizationId", "lastName", "firstName");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
