import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { AvailabilityUnavailableError, readHospitalityAvailability } from '../availability/hospitality-availability-service.ts';
import { db } from '../database.ts';
import { HospitalityPricingUnavailableError, quoteHospitalityPrice } from '../pricing/hospitality-pricing-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeHospitalityOfferSearchInput, type HospitalityOfferSearchInput } from './hospitality-search-domain.ts';

const MAX_SEARCH_SCOPES = 50;
const MAX_SEARCH_RESULTS = 25;

export async function searchHospitalityOffers(input: {
  organizationId: string;
  actorUserId: string;
  search: HospitalityOfferSearchInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const search = normalizeHospitalityOfferSearchInput(input.search);
  if (search.propertyId) assertUuidIdentifier(search.propertyId, 'propertyId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
  ]);

  const scopes = await db.hospitalityRoomTypeRatePlan.findMany({
    where: {
      organizationId: input.organizationId,
      ...(search.propertyId ? { propertyId: search.propertyId } : {}),
      roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
    },
    select: {
      propertyId: true,
      roomTypeId: true,
      ratePlanId: true,
      roomType: { select: { name: true, code: true, maxOccupancy: true, property: { select: { name: true, code: true, city: true, region: true, countryCode: true } } } },
      ratePlan: { select: { name: true, code: true, description: true } },
    },
    orderBy: [{ propertyId: 'asc' }, { roomTypeId: 'asc' }, { ratePlanId: 'asc' }],
    take: MAX_SEARCH_SCOPES,
  });

  const candidates = await Promise.all(scopes.map(async (scope) => {
    const request = {
      propertyId: scope.propertyId,
      roomTypeId: scope.roomTypeId,
      ratePlanId: scope.ratePlanId,
      arrivalDate: input.search.arrivalDate,
      departureDate: input.search.departureDate,
      quantity: search.quantity,
    };
    try {
      const availability = await readHospitalityAvailability({ organizationId: input.organizationId, actorUserId: input.actorUserId, request, now: input.now });
      if (!availability.available) return null;
      const quote = await quoteHospitalityPrice({ organizationId: input.organizationId, actorUserId: input.actorUserId, request });
      return {
        property: { id: scope.propertyId, ...scope.roomType.property },
        roomType: { id: scope.roomTypeId, name: scope.roomType.name, code: scope.roomType.code, maxOccupancy: scope.roomType.maxOccupancy },
        ratePlan: { id: scope.ratePlanId, ...scope.ratePlan },
        stay: { arrivalDate: input.search.arrivalDate, departureDate: input.search.departureDate, nights: search.stayNights, quantity: search.quantity },
        capacity: { sellableUnits: availability.capacity.sellableUnits, remainingUnits: availability.capacity.remainingUnits },
        price: { currency: quote.currency, accommodationSubtotalMinor: quote.accommodationSubtotal.amountMinor, taxTotalMinor: quote.taxes.amountMinor, feeTotalMinor: quote.fees.amountMinor, totalMinor: quote.total.amountMinor, fingerprint: quote.fingerprint },
      };
    } catch (error) {
      if (error instanceof AvailabilityUnavailableError || error instanceof HospitalityPricingUnavailableError) return null;
      throw error;
    }
  }));

  const offers = candidates.filter((offer): offer is NonNullable<typeof offer> => offer !== null);
  offers.sort((left, right) => {
    const leftTotal = BigInt(left.price.totalMinor);
    const rightTotal = BigInt(right.price.totalMinor);
    if (leftTotal < rightTotal) return -1;
    if (leftTotal > rightTotal) return 1;
    return `${left.property.name}:${left.roomType.name}:${left.ratePlan.name}`.localeCompare(`${right.property.name}:${right.roomType.name}:${right.ratePlan.name}`);
  });

  return { offers: offers.slice(0, MAX_SEARCH_RESULTS), searchedScopes: scopes.length, resultLimit: MAX_SEARCH_RESULTS };
}
