'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';

type ApplicationShellProps = {
  children: ReactNode;
  userName: string;
  userEmail: string;
  organizationName?: string | null;
  organizationSlug?: string | null;
  role?: string | null;
  contentAsMain?: boolean;
};

const navigation = [
  { href: '/dashboard', label: 'Dashboard', exact: true },
  { href: '/account', label: 'Account', exact: false },
] as const;

function isActivePath(pathname: string, href: string, exact: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function ApplicationShell({
  children,
  userName,
  userEmail,
  organizationName,
  organizationSlug,
  role,
  contentAsMain = true,
}: ApplicationShellProps) {
  const pathname = usePathname();
  const content = contentAsMain ? (
    <main className="sf-app-main" id="sf-main-content" tabIndex={-1}>{children}</main>
  ) : (
    <div className="sf-app-main" id="sf-main-content" tabIndex={-1}>{children}</div>
  );

  return (
    <div className="sf-app-shell">
      <a className="sf-skip-link" href="#sf-main-content">Skip to main content</a>

      <aside className="sf-app-sidebar" aria-label="Primary navigation">
        <Link className="sf-app-sidebar__brand" href="/dashboard" aria-label="SF dashboard">
          <BrandMark />
        </Link>
        <nav className="sf-app-nav">
          {navigation.map((item) => {
            const active = isActivePath(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                className={`sf-app-nav__link${active ? ' sf-app-nav__link--active' : ''}`}
                href={item.href}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sf-app-sidebar__context">
          <span className="sf-app-sidebar__context-label">Active tenant</span>
          <strong>{organizationName ?? 'No organization selected'}</strong>
          {organizationSlug ? <span>{organizationSlug}</span> : null}
        </div>
      </aside>

      <div className="sf-app-workspace">
        <header className="sf-app-header">
          <div className="sf-app-header__tenant">
            <span>Organization</span>
            <strong>{organizationName ?? 'Select an organization'}</strong>
          </div>
          <div className="sf-app-header__account">
            <div>
              <strong>{userName}</strong>
              <span>{role ? role.toLowerCase() : userEmail}</span>
            </div>
            <Link className="sf-button sf-button--secondary sf-button--compact" href="/account">Account</Link>
            <form action="/api/auth/sign-out" method="post">
              <button className="sf-button sf-button--secondary sf-button--compact" type="submit">Sign out</button>
            </form>
          </div>
        </header>

        {content}
      </div>

      <nav className="sf-app-mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => {
          const active = isActivePath(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              className={`sf-app-mobile-nav__link${active ? ' sf-app-mobile-nav__link--active' : ''}`}
              href={item.href}
              aria-current={active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
