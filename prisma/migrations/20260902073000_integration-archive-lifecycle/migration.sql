ALTER TYPE "IntegrationStatus" ADD VALUE 'ARCHIVED';

ALTER TABLE "integrations"
  ALTER COLUMN "encryptedCredentials" DROP NOT NULL,
  ADD COLUMN "archivedAt" TIMESTAMPTZ(6);
