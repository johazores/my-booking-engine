export function hospitalityPricingScopeLockKey(input: {
  organizationId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
}) {
  return `pricing:${input.organizationId}:${input.propertyId}:${input.roomTypeId}:${input.ratePlanId}`;
}
