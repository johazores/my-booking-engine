import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { archiveHospitalityBaseRate } from '@/server/pricing/hospitality-pricing-service.ts';
import { pricingErrorCode, pricingErrorTarget, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'base-rate-id': string }> }) {
  const observation = createRequestObservation(request, { operation: 'pricing.base-rate.archive' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    applyAuthResponseNoStore(response),
    { organizationId },
    failureOutcome ? { failureOutcome } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) return finish(new Response('Forbidden', { status: 403 }));
  if (!isSupportedAuthFormRequest(request)) return finish(new Response('Unsupported Media Type', { status: 415 }));

  let session: Awaited<ReturnType<typeof readAuthSession>>;
  try {
    session = await readAuthSession();
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!session) return finish(redirectToLocalPath('/sign-in?error=required'), 'rejected');

  let activeContext: Awaited<ReturnType<typeof readActiveOrganizationContext>>;
  try {
    activeContext = await readActiveOrganizationContext(session.user.id);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!activeContext.organization) {
    return finish(redirectToLocalPath('/pricing?error=tenant'), 'rejected');
  }
  organizationId = activeContext.organization.id;

  const routeParams = await params;
  let formData: FormData;
  try {
    formData = await readBoundedFormDataOrThrow(request);
  } catch {
    return finish(redirectToLocalPath('/pricing?error=validation'), 'rejected');
  }

  let propertyId = '';
  let roomTypeId = '';
  let ratePlanId = '';
  try {
    propertyId = pricingFormField(formData, 'propertyId');
    roomTypeId = pricingFormField(formData, 'roomTypeId');
    ratePlanId = pricingFormField(formData, 'ratePlanId');
    await archiveHospitalityBaseRate({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      baseRateId: routeParams['base-rate-id'],
    });
    return finish(redirectToLocalPath(`/pricing/${encodeURIComponent(propertyId)}?ratePlan=${encodeURIComponent(ratePlanId)}&roomType=${encodeURIComponent(roomTypeId)}&status=base-rate-archived`));
  } catch (error) {
    const target = pricingErrorTarget(propertyId);
    const code = pricingErrorCode(error);
    const query = new URLSearchParams({ error: code });
    if (ratePlanId) query.set('ratePlan', ratePlanId);
    if (roomTypeId) query.set('roomType', roomTypeId);
    return finish(
      redirectToLocalPath(`${target}?${query.toString()}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
