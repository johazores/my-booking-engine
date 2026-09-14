ALTER TABLE "rental_unit_types"
  ADD CONSTRAINT "rental_unit_types_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_locations"
  ADD CONSTRAINT "rental_locations_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_unit_types"
  ADD CONSTRAINT "rental_unit_types_archive_state_check" CHECK (
    ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
    OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
  );

ALTER TABLE "rental_units"
  ADD CONSTRAINT "rental_units_archive_state_check" CHECK (
    ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
    OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
  );

ALTER TABLE "rental_locations"
  ADD CONSTRAINT "rental_locations_archive_state_check" CHECK (
    ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
    OR ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
  );
