CREATE TYPE "PlatformRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "OrganizationRole" AS ENUM ('ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER');

ALTER TABLE "users" ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';
ALTER TABLE "organization_memberships" ADD COLUMN "role" "OrganizationRole" NOT NULL DEFAULT 'STAFF';

WITH ranked_memberships AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "organizationId"
           ORDER BY "createdAt" ASC, id ASC
         ) AS rank
  FROM "organization_memberships"
  WHERE status = 'ACTIVE'
)
UPDATE "organization_memberships" membership
SET role = 'ADMIN'
FROM ranked_memberships ranked
WHERE membership.id = ranked.id
  AND ranked.rank = 1;

CREATE INDEX "users_platformRole_status_idx" ON "users"("platformRole", "status");
CREATE INDEX "organization_memberships_organizationId_role_status_idx" ON "organization_memberships"("organizationId", "role", "status");

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "resourceType" VARCHAR(80) NOT NULL,
  "resourceId" VARCHAR(120) NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_organizationId_createdAt_idx" ON "audit_events"("organizationId", "createdAt");
CREATE INDEX "audit_events_actorUserId_createdAt_idx" ON "audit_events"("actorUserId", "createdAt");
CREATE INDEX "audit_events_resourceType_resourceId_idx" ON "audit_events"("resourceType", "resourceId");

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
