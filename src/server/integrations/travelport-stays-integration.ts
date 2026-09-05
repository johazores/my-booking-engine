import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { TravelportStaysBookingTermsProvider } from '../suppliers/travelport-stays-booking-terms-provider.ts';
import {
  probeTravelportStaysIntegrationHealth,
  readTravelportStaysCredentials,
  TravelportStaysProvider,
  type TravelportStaysCredentials,
} from '../suppliers/travelport-stays-provider.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type { IntegrationHealthStatus, IntegrationProviderFailureCode } from './integration-domain.ts';
import { IntegrationLifecycleError, loadActiveIntegrationCredentials } from './integration-service.ts';

export type TravelportStaysIntegrationHealthResult = Readonly<{
  status: IntegrationHealthStatus;
  failureCode: IntegrationProviderFailureCode | null;
}>;

export async function testTravelportStaysIntegrationConnection(input: {
  organizationId: string;
  actorUserId: string;
  fetchImpl?: typeof fetch;
}): Promise<TravelportStaysIntegrationHealthResult> {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:manage',
  });

  const { integration, credentials } = await loadActiveIntegrationCredentials({
    organizationId: input.organizationId,
    providerCode: 'travelport-stays',
  });
  const result = await probeTravelportStaysIntegrationHealth({
    credentials: readTravelportStaysCredentials(credentials),
    fetchImpl: input.fetchImpl,
  });

  const current = await db.integration.findFirst({
    where: { id: integration.id, organizationId: input.organizationId },
    select: { status: true, credentialVersion: true },
  });
  if (!current || current.status !== 'ACTIVE' || current.credentialVersion !== integration.credentialVersion) {
    throw new IntegrationLifecycleError('Integration configuration changed while the connection test was running. Run the test again.');
  }

  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'integration.connection-tested',
      resourceType: 'integration',
      resourceId: integration.id,
      afterData: {
        providerCode: integration.providerCode,
        result: result.status,
        failureCode: result.failureCode,
        credentialVersion: integration.credentialVersion,
      },
    },
  });

  return result;
}

export async function loadTravelportStaysIntegration(organizationId: string): Promise<Readonly<{
  integration: Awaited<ReturnType<typeof loadActiveIntegrationCredentials>>['integration'];
  provider: TravelportStaysProvider;
  bookingTermsProvider: TravelportStaysBookingTermsProvider;
}>> {
  assertUuidIdentifier(organizationId, 'organizationId');
  const { integration, credentials } = await loadActiveIntegrationCredentials({
    organizationId,
    providerCode: 'travelport-stays',
  });
  const normalizedCredentials: TravelportStaysCredentials = readTravelportStaysCredentials(credentials);
  const cacheKey = `${integration.id}:${integration.credentialVersion}`;
  const provider = new TravelportStaysProvider({
    credentials: normalizedCredentials,
    cacheKey,
  });
  return Object.freeze({
    integration,
    provider,
    bookingTermsProvider: new TravelportStaysBookingTermsProvider({
      credentials: normalizedCredentials,
      cacheKey,
      pricingProvider: provider,
    }),
  });
}
