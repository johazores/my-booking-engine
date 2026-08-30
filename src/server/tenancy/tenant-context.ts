import { cookies } from 'next/headers';

import { findOrganizationForUser } from '../organizations/organization-repository.ts';

export const ACTIVE_ORGANIZATION_COOKIE = 'sf_organization';

export const activeOrganizationCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function readActiveOrganizationContext(userId: string) {
  const cookieStore = await cookies();
  const organizationId = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;

  if (!organizationId) {
    return { hadOrganizationCookie: false, organization: null } as const;
  }

  try {
    return {
      hadOrganizationCookie: true,
      organization: await findOrganizationForUser({ organizationId, userId }),
    } as const;
  } catch {
    return { hadOrganizationCookie: true, organization: null } as const;
  }
}
