import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { AvailabilityUnavailableError, readHospitalityAvailability } from '../availability/hospitality-availability-service.ts';
import { db } from '../database.ts';
import { HospitalityPricingUnavailableError, quoteHospitalityPrice } from '../pricing/hospitality-pricing-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeHospitalityOfferSearchInput, type HospitalityOfferSearchInput } from './hospitality-search-domain.ts';

const MAX_SEARCH_SCOPES = 50;
const MAX_SEARCH_RESULTS = 25;
const SEARCH_BATCH_SIZE = 8;

type SearchScope = Awaited<ReturnType<typeof loadSearchScopes>>['scopes'][number];

async function loadSearchScopes(input: { organizationId: string; propertyId: string | null }) {
  const where = {
    organizationId: input.organizationId,
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    roomType: { is: { status: 'ACTIVE' as const, property: { is: { status: 'ACTIVE' as const } } } },
    ratePlan: { is: { status: 'ACTIVE' as const, property: { is: { status: 'ACTIVE' as const } } } },
  };
  const [totalScopes, scopes] = await Promise.all([
    db.hospitalityRoomTypeRatePlan.count({ where }),
    db.hospitalityRoomTypeRatePlan.findMany({
      where,
      select: {
        propertyId: true,
        roomTypeId: true,
        ratePlanId: true,
        roomType: { select: { name: true, code: true, maxOccupancy: true, property: { select: { name: true, code: true, city: true, region: true, countryCode: true } } } },
        ratePlan: { select: { name: true, code: true, description: true } },
      },
      orderBy: [{ propertyId: 'asc' }, { roomTypeId: 'asc' }, { ratePlanId: 'asc' }],
      take: MAX_SEARCH_SCOPES,
    }),
  ]);
  return { totalScopes, scopes };
}

async function evaluateScope(input: {
  scope: SearchScope;
  organizationId: string;
  actorUserId: string;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  stayNights: number;
  now?: Date;
}) {
  const request = {
    propertyId: input.scope.propertyId,
    roomTypeId: input.scope.roomTypeId,
    ratePlanId: input.scope.ratePlanId,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    quantity: input.quantity,
  };
  try {
    const availability = await readHospitalityAvailability({ organizationId: input.organizationId, actorUserId: input.actorUserId, request, now: input.now });
    if (!availability.available) return null;
    const quote = await quoteHospitalityPrice({ organizationId: input.organizationId, actorUserId: input.actorUserId, request });
    return {
      property: { id: input.scope.propertyId, ...input.scope.roomType.property },
      roomType: { id: input.scope.roomTypeId, name: input.scope.roomType.name, code: input.scope.roomType.code, maxOccupancy: input.scope.roomType.maxOccupancy },
      ratePlan: { id: input.scope.ratePlanId, ...input.scope.ratePlan },
      stay: { arrivalDate: input.arrivalDate, departureDate: input.departureDate, nights: input.stayNights, quantity: input.quantity },
      capacity: { sellableUnits: availability.capacity.sellableUnits, remainingUnits: availability.capacity.remainingUnits },
      price: { currency: quote.currency, accommodationSubtotalMinor: quote.accommodationSubtotal.amountMinor, taxTotalMinor: quote.taxes.amountMinor, feeTotalMinor: quote.fees.amountMinor, totalMinor: quote.total.amountMinor, fingerprint: quote.fingerprint },
    };
  } catch (error) {
    if (error instanceof AvailabilityUnavailableError || error instanceof HospitalityPricingUnavailableError) return null;
    throw error;
  }
}

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

  const { totalScopes, scopes } = await loadSearchScopes({ organizationId: input.organizationId, propertyId: search.propertyId });
  const candidates = [] as Awaited<ReturnType<typeof evaluateScope>>[];
  for (let offset = 0; offset < scopes.length; offset += SEARCH_BATCH_SIZE) {
    const batch = scopes.slice(offset, offset + SEARCH_BATCH_SIZE);
    candidates.push(...await Promise.all(batch.map((scope) => evaluateScope({
      scope,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      arrivalDate: search.arrivalDate,
      departureDate: search.departureDate,
      quantity: search.quantity,
      stayNights: search.stayNights,
      now: input.now,
    }))));
  }

  const sellableOffers = candidates.filter((offer): offer is NonNullable<typeof offer> => offer !== null);
  sellableOffers.sort((left, right) => {
    const leftTotal = BigInt(left.price.totalMinor);
    const rightTotal = BigInt(right.price.totalMinor);
    if (leftTotal < rightTotal) return -1;
    if (leftTotal > rightTotal) return 1;
    const leftKey = `${left.property.id}:${left.roomType.id}:${left.ratePlan.id}`;
    const rightKey = `${right.property.id}:${right.roomType.id}:${right.ratePlan.id}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  return {
    offers: sellableOffers.slice(0, MAX_SEARCH_RESULTS),
    searchedScopes: scopes.length,
    totalScopes,
    scopeLimit: MAX_SEARCH_SCOPES,
    scopeLimitReached: totalScopes > scopes.length,
    resultLimit: MAX_SEARCH_RESULTS,
    resultLimitReached: sellableOffers.length > MAX_SEARCH_RESULTS,
  };
}
