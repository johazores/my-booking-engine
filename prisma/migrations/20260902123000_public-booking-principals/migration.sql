CREATE TABLE "public_booking_principals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "public_booking_principals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "public_booking_principals_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "public_booking_hold_ownership" (
    "organizationId" UUID NOT NULL,
    "holdId" UUID NOT NULL,
    "principalId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_booking_hold_ownership_pkey" PRIMARY KEY ("organizationId", "holdId")
);

CREATE TABLE "public_booking_audit_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorPrincipalId" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(120) NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_booking_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_booking_principals_id_organizationId_key" ON "public_booking_principals"("id", "organizationId");
CREATE INDEX "public_booking_principals_org_expiry_idx" ON "public_booking_principals"("organizationId", "expiresAt");
CREATE INDEX "public_booking_hold_owner_principal_idx" ON "public_booking_hold_ownership"("organizationId", "principalId");
CREATE INDEX "public_booking_audit_org_created_idx" ON "public_booking_audit_events"("organizationId", "createdAt");
CREATE INDEX "public_booking_audit_actor_created_idx" ON "public_booking_audit_events"("organizationId", "actorPrincipalId", "createdAt");
CREATE INDEX "public_booking_audit_resource_idx" ON "public_booking_audit_events"("resourceType", "resourceId");

ALTER TABLE "public_booking_principals" ADD CONSTRAINT "public_booking_principals_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public_booking_hold_ownership" ADD CONSTRAINT "public_booking_hold_owner_principal_fkey" FOREIGN KEY ("principalId", "organizationId") REFERENCES "public_booking_principals"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public_booking_hold_ownership" ADD CONSTRAINT "public_booking_hold_owner_hold_fkey" FOREIGN KEY ("holdId", "organizationId") REFERENCES "hospitality_availability_holds"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public_booking_audit_events" ADD CONSTRAINT "public_booking_audit_principal_fkey" FOREIGN KEY ("actorPrincipalId", "organizationId") REFERENCES "public_booking_principals"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
