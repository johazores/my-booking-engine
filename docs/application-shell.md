# Persistent Application Shell

## Status

Phase 5 is implemented. `/dashboard` and `/account` now share the same authenticated SF workspace shell, tenant identity, account controls, responsive navigation, active navigation behavior, and loading presentation.

## Security boundary

The shell is presentation, not authorization. `src/components/authenticated-application-shell.tsx` resolves the authenticated server session, revalidates the active organization context, and reads authorization before passing safe display context into the client shell.

Protected pages still perform the server reads and permission checks required for their own data and mutations. Layout execution is not treated as a substitute for page/service authorization.

The active-organization cookie remains only a preference. Tenant access continues to be revalidated through the server tenant boundary.

## Navigation

Current real navigation targets are intentionally limited to implemented product surfaces:

- Dashboard — `/dashboard`
- Account and organization administration — `/account`

Do not add placeholder navigation for customers, bookings, payments, inventory, settings, or integrations until those workflows exist.

Desktop uses a persistent left sidebar plus sticky tenant/account header. Mobile uses a compact fixed navigation surface with touch-sized targets. Both derive active navigation state from the current pathname and expose `aria-current`.

## Shared authenticated boundary

`AuthenticatedApplicationShell` is the canonical server wrapper for authenticated workspace routes. It centralizes:

- session enforcement and redirect behavior
- active-organization revalidation
- safe tenant identity for display
- current organization role for display
- handoff into the client navigation shell

`ApplicationShell` supports both a semantic main wrapper and a neutral content wrapper so legacy pages that already own their `<main>` landmark can be integrated without nested main landmarks while they are incrementally refactored.

## Dashboard data

The dashboard remains operationally honest. It renders only persisted or server-derived information:

- active organization identity, kind, slug, timezone, and currency
- authenticated organization/platform role
- active and total membership counts only when the current actor has `membership:read`
- the current authenticated email and server-revalidated tenant/authorization status

It must not invent booking volume, revenue, conversion, occupancy, integration health, or other analytics before those domains exist.

## Account administration integration

`/account` now renders inside the canonical application shell while preserving its existing server-side authentication, tenant revalidation, permission checks, organization switching, settings, lifecycle, and membership-management behavior. The previous standalone account header is suppressed inside the workspace so the canonical tenant/account header is the only visible application header.

Account loading now uses the same workspace loading pattern and explicitly communicates that session, tenant access, and organization permissions are being resolved.

## Accessibility and responsive behavior

The workspace includes:

- skip-to-content navigation
- semantic primary and mobile navigation labels
- visible global focus states
- `aria-current` for active navigation
- responsive desktop/tablet/mobile layouts
- touch-sized mobile navigation
- loading feedback while session, tenant context, and permissions resolve
- reduced-motion handling for loading indicators
- no nested `<main>` landmark when integrating pages that already provide their own main landmark

## Next integration rule

All new authenticated product modules should be added under the canonical workspace shell. Existing protected service boundaries remain authoritative for authentication, tenant scope, and authorization; the shell must never become the only security control.
