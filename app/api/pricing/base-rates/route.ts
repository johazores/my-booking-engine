import { readBoundedFormDataOrThrow } from '@/server/http/bounded-form-body.ts';

import {
  applyAuthResponseNoStore,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
  redirectToLocalPath,
} from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { createHospitalityBaseRate } from '@/server/pricing/hospitality-pricing-service.ts';
import { pricingErrorCode, pricingErrorTarget, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'pricing.base-rate.create' });
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
    await createHospitalityBaseRate({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      baseRate: {
        propertyId,
        roomTypeId,
        ratePlanId,
        startDate: pricingFormField(formData, 'startDate'),
        endDate: pricingFormField(formData, 'endDate'),
        amount: pricingFormField(formData, 'amount'),
      },
    });
    return finish(redirectToLocalPath(`/pricing/${encodeURIComponent(propertyId)}?ratePlan=${encodeURIComponent(ratePlanId)}&roomType=${encodeURIComponent(roomTypeId)}&status=base-rate-created`));
  } catch (error) {
    const target = pricingErrorTarget(propertyId);
    const code = pricingErrorCode(error);
    const params = new URLSearchParams({ error: code });
    if (ratePlanId) params.set('ratePlan', ratePlanId);
    if (roomTypeId) params.set('roomType', roomTypeId);
    return finish(
      redirectToLocalPath(`${target}?${params.toString()}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
