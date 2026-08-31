export function hospitalityAvailabilityAllocationLockKey(input: {
  organizationId: string;
  propertyId: string;
  roomTypeId: string;
}) {
  return `availability:${input.organizationId}:${input.propertyId}:${input.roomTypeId}`;
}
