CREATE TABLE "hospitality_property_images" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "altText" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "hospitality_property_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_property_images_url_https" CHECK ("url" ~ '^https://'),
    CONSTRAINT "hospitality_property_images_alt_not_blank" CHECK ("altText" = btrim("altText") AND char_length("altText") > 0),
    CONSTRAINT "hospitality_property_images_sort_order" CHECK ("sortOrder" >= 0 AND "sortOrder" <= 9999)
);

CREATE TABLE "hospitality_room_type_images" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "altText" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "hospitality_room_type_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospitality_room_type_images_url_https" CHECK ("url" ~ '^https://'),
    CONSTRAINT "hospitality_room_type_images_alt_not_blank" CHECK ("altText" = btrim("altText") AND char_length("altText") > 0),
    CONSTRAINT "hospitality_room_type_images_sort_order" CHECK ("sortOrder" >= 0 AND "sortOrder" <= 9999)
);

CREATE UNIQUE INDEX "hospitality_property_images_id_organizationId_key" ON "hospitality_property_images"("id", "organizationId");
CREATE INDEX "hospitality_property_images_organizationId_propertyId_isPrimary_sortOrder_idx" ON "hospitality_property_images"("organizationId", "propertyId", "isPrimary", "sortOrder");
CREATE UNIQUE INDEX "hospitality_room_type_images_id_organizationId_key" ON "hospitality_room_type_images"("id", "organizationId");
CREATE INDEX "hospitality_room_type_images_organizationId_propertyId_roomTypeId_isPrimary_sortOrder_idx" ON "hospitality_room_type_images"("organizationId", "propertyId", "roomTypeId", "isPrimary", "sortOrder");

ALTER TABLE "hospitality_property_images" ADD CONSTRAINT "hospitality_property_images_propertyId_organizationId_fkey" FOREIGN KEY ("propertyId", "organizationId") REFERENCES "hospitality_properties"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hospitality_room_type_images" ADD CONSTRAINT "hospitality_room_type_images_roomTypeId_propertyId_organizationId_fkey" FOREIGN KEY ("roomTypeId", "propertyId", "organizationId") REFERENCES "hospitality_room_types"("id", "propertyId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
