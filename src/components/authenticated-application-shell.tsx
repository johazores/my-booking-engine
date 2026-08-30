import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { ApplicationShell } from '@/components/application-shell';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

type AuthenticatedApplicationShellProps = {
  children: ReactNode;
  contentAsMain?: boolean;
};

export async function AuthenticatedApplicationShell({
  children,
  contentAsMain = true,
}: AuthenticatedApplicationShellProps) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);

  const session = authState.session;
  if (!session) throw new Error('Authenticated application shell guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  const authorization = activeContext.organization
    ? await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id })
    : null;

  return (
    <ApplicationShell
      userName={session.user.displayName || session.user.email}
      userEmail={session.user.email}
      organizationName={activeContext.organization?.name}
      organizationSlug={activeContext.organization?.slug}
      role={authorization?.role}
      contentAsMain={contentAsMain}
    >
      {children}
    </ApplicationShell>
  );
}
