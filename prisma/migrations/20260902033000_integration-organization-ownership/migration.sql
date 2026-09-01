ALTER TABLE "integrations"
ADD CONSTRAINT "integrations_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
