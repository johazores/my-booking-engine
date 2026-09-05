import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type {
  HospitalitySupplierOfferRevalidationInput,
  HospitalitySupplierOfferSearchInput,
  HospitalitySupplierSearchInput,
} from './hospitality-supplier-provider.ts';
import { collectHospitalitySupplierPropertySearch } from './hospitality-supplier-search.ts';

async function requireSupplierReadAuthority(input: {
  organizationId: string;
  actorUserId: string;
  pricing: boolean;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });
  if (input.pricing) {
    await requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'pricing:read',
    });
  }
}

export async function searchHospitalitySupplierProperties(input: {
  organizationId: string;
  actorUserId: string;
  search: HospitalitySupplierSearchInput;
}) {
  await requireSupplierReadAuthority({ ...input, pricing: false });
  const { provider } = await loadTravelportStaysIntegration(input.organizationId);
  return collectHospitalitySupplierPropertySearch(provider, input.search);
}

export async function searchHospitalitySupplierPropertyOffers(input: {
  organizationId: string;
  actorUserId: string;
  search: HospitalitySupplierOfferSearchInput;
}) {
  await requireSupplierReadAuthority({ ...input, pricing: true });
  const { provider } = await loadTravelportStaysIntegration(input.organizationId);
  return provider.searchPropertyOffers(input.search);
}

export async function revalidateHospitalitySupplierPropertyOffer(input: {
  organizationId: string;
  actorUserId: string;
  search: HospitalitySupplierOfferRevalidationInput;
}) {
  await requireSupplierReadAuthority({ ...input, pricing: true });
  const { provider } = await loadTravelportStaysIntegration(input.organizationId);
  return provider.revalidatePropertyOffer(input.search);
}
