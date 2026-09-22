ALTER TABLE "hospitality_room_type_amenities"
  RENAME CONSTRAINT "hospitality_room_type_amenities_roomTypeId_propertyId_organizat"
  TO "hospitality_room_type_amenities_room_type_fkey";

ALTER INDEX "hospitality_property_images_organizationId_propertyId_isPrimary"
  RENAME TO "hospitality_property_images_scope_sort_idx";
ALTER INDEX "hospitality_room_type_images_organizationId_propertyId_roomType"
  RENAME TO "hospitality_room_type_images_scope_sort_idx";
ALTER TABLE "hospitality_room_type_images"
  RENAME CONSTRAINT "hospitality_room_type_images_roomTypeId_propertyId_organization"
  TO "hospitality_room_type_images_room_type_fkey";

ALTER TABLE "hospitality_room_type_rate_plans"
  RENAME CONSTRAINT "hospitality_room_type_rate_plans_roomTypeId_propertyId_organiza"
  TO "hospitality_room_type_rate_plans_room_type_fkey";
ALTER TABLE "hospitality_room_type_rate_plans"
  RENAME CONSTRAINT "hospitality_room_type_rate_plans_ratePlanId_propertyId_organiza"
  TO "hospitality_room_type_rate_plans_rate_plan_fkey";

ALTER TABLE "hospitality_restrictions"
  RENAME CONSTRAINT "hospitality_restrictions_ratePlanId_propertyId_organizationId_f"
  TO "hospitality_restrictions_rate_plan_fkey";
ALTER TABLE "hospitality_restrictions"
  RENAME CONSTRAINT "hospitality_restrictions_roomTypeId_propertyId_organizationId_f"
  TO "hospitality_restrictions_room_type_fkey";
ALTER INDEX "hospitality_restrictions_organizationId_propertyId_ratePlanId_s"
  RENAME TO "hospitality_restrictions_rate_plan_dates_idx";
ALTER INDEX "hospitality_restrictions_organizationId_propertyId_roomTypeId_s"
  RENAME TO "hospitality_restrictions_room_type_dates_idx";

ALTER INDEX "hospitality_availability_windows_id_propertyId_organizationId_k"
  RENAME TO "hospitality_availability_windows_id_property_org_key";
ALTER INDEX "hospitality_availability_windows_organizationId_propertyId_room"
  RENAME TO "hospitality_availability_windows_scope_start_idx";
ALTER TABLE "hospitality_availability_windows"
  RENAME CONSTRAINT "hospitality_availability_windows_roomTypeId_propertyId_organiza"
  TO "hospitality_availability_windows_room_type_fkey";
