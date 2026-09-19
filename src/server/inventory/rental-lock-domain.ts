export function rentalUnitLockKey(organizationId: string, unitId: string) {
  return `sf:rental-unit:${organizationId}:${unitId}`;
}

export function rentalLocationLifecycleLockKey(organizationId: string, locationId: string) {
  return `sf:rental-location-lifecycle:${organizationId}:${locationId}`;
}

export function rentalUnitTypeLifecycleLockKey(organizationId: string, unitTypeId: string) {
  return `sf:rental-unit-type-lifecycle:${organizationId}:${unitTypeId}`;
}
