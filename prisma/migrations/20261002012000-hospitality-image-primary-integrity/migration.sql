-- Enforce at most one primary image per tenant-owned gallery without changing
-- Prisma's persisted image shape. Expression indexes are intentionally used here
-- because Prisma ORM does not model PostgreSQL expression indexes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hospitality_property_images"
    WHERE "isPrimary" = TRUE
    GROUP BY "organizationId", "propertyId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce property image primary integrity: duplicate primary rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "hospitality_room_type_images"
    WHERE "isPrimary" = TRUE
    GROUP BY "organizationId", "propertyId", "roomTypeId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce room-type image primary integrity: duplicate primary rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "hospitality_property_images_one_primary_key"
ON "hospitality_property_images" (
  (CASE WHEN "isPrimary" THEN "organizationId" ELSE NULL END),
  (CASE WHEN "isPrimary" THEN "propertyId" ELSE NULL END)
);

CREATE UNIQUE INDEX "hospitality_room_type_images_one_primary_key"
ON "hospitality_room_type_images" (
  (CASE WHEN "isPrimary" THEN "organizationId" ELSE NULL END),
  (CASE WHEN "isPrimary" THEN "propertyId" ELSE NULL END),
  (CASE WHEN "isPrimary" THEN "roomTypeId" ELSE NULL END)
);
