import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthenticatedApplicationShell } from '@/components/authenticated-application-shell';
import { readAuthenticatedBrandMetadata } from '@/server/branding/branding-metadata.ts';

export async function generateMetadata(): Promise<Metadata> {
  return readAuthenticatedBrandMetadata();
}

export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthenticatedApplicationShell contentAsMain={false}>{children}</AuthenticatedApplicationShell>;
}
