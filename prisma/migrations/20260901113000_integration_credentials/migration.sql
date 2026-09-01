CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "integrations" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "providerCode" VARCHAR(64) NOT NULL,
  "displayName" VARCHAR(120) NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "capabilities" TEXT[] NOT NULL,
  "encryptedCredentials" TEXT NOT NULL,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integrations_organizationId_providerCode_key" ON "integrations"("organizationId", "providerCode");
CREATE UNIQUE INDEX "integrations_id_organizationId_key" ON "integrations"("id", "organizationId");
CREATE INDEX "integrations_organizationId_status_providerCode_idx" ON "integrations"("organizationId", "status", "providerCode");
