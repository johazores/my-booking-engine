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
import { AppointmentInventoryValidationError } from './appointment-domain.ts';
import {
  AppointmentInventoryConflictError,
  AppointmentInventoryDependencyError,
  AppointmentInventoryUnavailableError,
} from './appointment-service.ts';
import { HospitalityInventoryValidationError } from './hospitality-domain.ts';
import {
  HospitalityInventoryConflictError,
  HospitalityInventoryDependencyError,
  HospitalityInventoryUnavailableError,
} from './hospitality-service.ts';
import { RentalInventoryValidationError } from './rental-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryDependencyError,
  RentalInventoryUnavailableError,
} from './rental-service.ts';
import { TourInventoryValidationError } from './tour-domain.ts';
import {
  TourInventoryConflictError,
  TourInventoryDependencyError,
  TourInventoryUnavailableError,
} from './tour-service.ts';

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
  if (
    error instanceof HospitalityInventoryConflictError ||
    error instanceof TourInventoryConflictError ||
    error instanceof AppointmentInventoryConflictError ||
    error instanceof RentalInventoryConflictError
  ) return 'conflict';
  if (
    error instanceof HospitalityInventoryDependencyError ||
    error instanceof TourInventoryDependencyError ||
    error instanceof AppointmentInventoryDependencyError ||
    error instanceof RentalInventoryDependencyError
  ) return 'dependency';
  if (
    error instanceof HospitalityInventoryUnavailableError ||
    error instanceof TourInventoryUnavailableError ||
    error instanceof AppointmentInventoryUnavailableError ||
    error instanceof RentalInventoryUnavailableError
  ) return 'unavailable';
  if (
    error instanceof HospitalityInventoryValidationError ||
    error instanceof TourInventoryValidationError ||
    error instanceof AppointmentInventoryValidationError ||
    error instanceof RentalInventoryValidationError
  ) return 'validation';
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
