import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthenticatedApplicationShell } from '@/components/authenticated-application-shell';
import { readAuthenticatedBrandMetadata } from '@/server/branding/branding-metadata.ts';

import './bookings.css';

export async function generateMetadata(): Promise<Metadata> {
  const branding = await readAuthenticatedBrandMetadata();
  return { ...branding, title: 'Bookings' };
}

export default function BookingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthenticatedApplicationShell>{children}</AuthenticatedApplicationShell>;
}
