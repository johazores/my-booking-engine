import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type { HospitalitySupplierSearchInput } from './hospitality-supplier-provider.ts';
import { collectHospitalitySupplierPropertySearch } from './hospitality-supplier-search.ts';

export async function searchHospitalitySupplierProperties(input: {
  organizationId: string;
  actorUserId: string;
  search: HospitalitySupplierSearchInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });

  const { provider } = await loadTravelportStaysIntegration(input.organizationId);
  return collectHospitalitySupplierPropertySearch(provider, input.search);
}
