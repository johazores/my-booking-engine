import type { ReactNode } from 'react';

import { AuthenticatedApplicationShell } from '@/components/authenticated-application-shell';

export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthenticatedApplicationShell contentAsMain={false}>{children}</AuthenticatedApplicationShell>;
}
