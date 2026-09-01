import { NextResponse } from 'next/server';

import { isSameOriginAuthRequest, isSupportedAuthFormRequest, readAuthSession } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { listIntegrations, saveIntegration } from '@/server/integrations/integration-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function stripeConfiguration(formData: FormData) {
  const secretKey = field(formData, 'secretKey');
  const webhookSecret = field(formData, 'webhookSecret');
  if (!secretKey.startsWith('sk_') || secretKey.length < 12) throw new Error('Stripe secret key is invalid.');
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) throw new Error('Stripe webhook secret is invalid.');
  return {
    credentials: webhookSecret ? { secretKey, webhookSecret } : { secretKey },
    capabilities: webhookSecret
      ? ['payment-authorize', 'payment-capture', 'payment-refund', 'webhooks']
      : ['payment-authorize', 'payment-capture', 'payment-refund'],
  };
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return new Response('Forbidden', { status: 403 });
  if (!isSupportedAuthFormRequest(request)) return new Response('Unsupported Media Type', { status: 415 });

  const session = await readAuthSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303);
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return NextResponse.redirect(new URL('/integrations?error=tenant', request.url), 303);

  try {
    const formData = await request.formData();
    const configuration = stripeConfiguration(formData);
    const existing = await listIntegrations({ organizationId: activeContext.organization.id, actorUserId: session.user.id });
    const rotating = existing.some((integration) => integration.providerCode === 'stripe');
    await saveIntegration({
      organizationId: activeContext.organization.id,
      actorUserId: session.user.id,
      providerCode: 'stripe',
      displayName: 'Stripe',
      capabilities: configuration.capabilities,
      credentials: configuration.credentials,
    });
    return NextResponse.redirect(new URL(`/integrations?status=${rotating ? 'rotated' : 'configured'}`, request.url), 303);
  } catch (error) {
    const code = error instanceof OrganizationPermissionDeniedError ? 'permission' : error instanceof Error && /Stripe|credential|capabilit|display name|provider code/i.test(error.message) ? 'validation' : 'server';
    return NextResponse.redirect(new URL(`/integrations?error=${code}`, request.url), 303);
  }
}
