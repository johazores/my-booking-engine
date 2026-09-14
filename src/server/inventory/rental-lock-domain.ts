export function rentalUnitLockKey(organizationId: string, unitId: string) {
  return `sf:rental-unit:${organizationId}:${unitId}`;
}
