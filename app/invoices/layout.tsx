import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthenticatedApplicationShell } from '@/components/authenticated-application-shell';
import { readAuthenticatedBrandMetadata } from '@/server/branding/branding-metadata.ts';

import './invoices.css';

export async function generateMetadata(): Promise<Metadata> {
  const branding = await readAuthenticatedBrandMetadata();
  return { ...branding, title: 'Tax invoice' };
}

export default function InvoicesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthenticatedApplicationShell>{children}</AuthenticatedApplicationShell>;
}
