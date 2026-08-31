import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthenticatedApplicationShell } from '@/components/authenticated-application-shell';
import { readAuthenticatedBrandMetadata } from '@/server/branding/branding-metadata.ts';

export async function generateMetadata(): Promise<Metadata> {
  const branding = await readAuthenticatedBrandMetadata();
  return { ...branding, title: 'Pricing' };
}

export default function PricingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthenticatedApplicationShell>{children}</AuthenticatedApplicationShell>;
}
