import type { Metadata } from 'next';

import { readAuthSession } from '../auth/auth-http.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import { readOrganizationBranding } from './branding-service.ts';

export async function readAuthenticatedBrandMetadata(): Promise<Metadata> {
  const session = await readAuthSession();
  if (!session) return {};

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return {};

  const branding = await readOrganizationBranding({
    organizationId: activeContext.organization.id,
    userId: session.user.id,
  });
  if (!branding) return {};

  return {
    title: {
      default: branding.name,
      template: `%s | ${branding.name}`,
    },
    icons: branding.faviconUrl ? { icon: branding.faviconUrl } : undefined,
  };
}
