import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { createHospitalityChargeRule } from '@/server/pricing/hospitality-charge-service.ts';
import { pricingErrorCode, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'pricing.charge.create' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    response,
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
  if (!session) return finish(NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303), 'rejected');

  let activeContext: Awaited<ReturnType<typeof readActiveOrganizationContext>>;
  try {
    activeContext = await readActiveOrganizationContext(session.user.id);
  } catch {
    return finish(new Response('Internal Server Error', { status: 500 }));
  }
  if (!activeContext.organization) {
    return finish(NextResponse.redirect(new URL('/pricing?error=tenant', request.url), 303), 'rejected');
  }
  organizationId = activeContext.organization.id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return finish(NextResponse.redirect(new URL('/pricing?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  try {
    propertyId = pricingFormField(formData, 'propertyId');
    const scope = pricingFormField(formData, 'scope');
    const [roomTypeId = '', ratePlanId = ''] = scope ? scope.split('|', 2) : ['', ''];
    await createHospitalityChargeRule({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      rule: {
        propertyId,
        roomTypeId,
        ratePlanId,
        name: pricingFormField(formData, 'name'),
        code: pricingFormField(formData, 'code'),
        kind: pricingFormField(formData, 'kind'),
        calculation: pricingFormField(formData, 'calculation'),
        value: pricingFormField(formData, 'value'),
        startDate: pricingFormField(formData, 'startDate'),
        endDate: pricingFormField(formData, 'endDate'),
      },
    });
    return finish(NextResponse.redirect(new URL(`/pricing/${propertyId}/charges?status=charge-created`, request.url), 303));
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}/charges` : '/pricing';
    const code = pricingErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
