import { NextResponse } from 'next/server';

import {
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
  readAuthSession,
} from '../auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import {
  createRequestObservation,
  type RequestLogFailureOutcome,
} from '../observability/request-observability.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import { HospitalityInventoryValidationError } from './hospitality-domain.ts';
import {
  HospitalityInventoryConflictError,
  HospitalityInventoryDependencyError,
  HospitalityInventoryUnavailableError,
} from './hospitality-service.ts';

export function formField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function readInventoryFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

export function inventoryErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof HospitalityInventoryConflictError) return 'conflict';
  if (error instanceof HospitalityInventoryDependencyError) return 'dependency';
  if (error instanceof HospitalityInventoryUnavailableError) return 'unavailable';
  if (error instanceof HospitalityInventoryValidationError) return 'validation';
  return 'server';
}

export async function prepareInventoryMutationRequest(request: Request, operation: string) {
  const observation = createRequestObservation(request, { operation });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    response,
    { organizationId },
    failureOutcome ? { failureOutcome } : undefined,
  );

  if (!isSameOriginAuthRequest(request)) {
    return { ok: false as const, response: finish(new Response('Forbidden', { status: 403 })) };
  }
  if (!isSupportedAuthFormRequest(request)) {
    return { ok: false as const, response: finish(new Response('Unsupported Media Type', { status: 415 })) };
  }

  let session: Awaited<ReturnType<typeof readAuthSession>>;
  try {
    session = await readAuthSession();
  } catch {
    return { ok: false as const, response: finish(new Response('Internal Server Error', { status: 500 })) };
  }
  if (!session) {
    return {
      ok: false as const,
      response: finish(NextResponse.redirect(new URL('/sign-in?error=required', request.url), 303), 'rejected'),
    };
  }

  let activeContext: Awaited<ReturnType<typeof readActiveOrganizationContext>>;
  try {
    activeContext = await readActiveOrganizationContext(session.user.id);
  } catch {
    return { ok: false as const, response: finish(new Response('Internal Server Error', { status: 500 })) };
  }
  if (!activeContext.organization) {
    return {
      ok: false as const,
      response: finish(NextResponse.redirect(new URL('/inventory?error=tenant', request.url), 303), 'rejected'),
    };
  }

  organizationId = activeContext.organization.id;
  return {
    ok: true as const,
    session,
    organization: activeContext.organization,
    finish,
  };
}
