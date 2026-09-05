import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import { archiveHospitalityAddon } from '@/server/pricing/hospitality-addon-service.ts';
import { pricingErrorCode, pricingFormField } from '@/server/pricing/pricing-http.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'addon-id': string }> }) {
  const observation = createRequestObservation(request, { operation: 'pricing.addon.archive' });
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

  const routeParams = await params;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return finish(NextResponse.redirect(new URL('/pricing?error=validation', request.url), 303), 'rejected');
  }

  let propertyId = '';
  try {
    propertyId = pricingFormField(formData, 'propertyId');
    await archiveHospitalityAddon({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      propertyId,
      addonId: routeParams['addon-id'],
    });
    return finish(NextResponse.redirect(new URL(`/pricing/${propertyId}/addons?status=addon-archived`, request.url), 303));
  } catch (error) {
    const target = propertyId ? `/pricing/${propertyId}/addons` : '/pricing';
    const code = pricingErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${target}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
