# Persistent Application Shell

## Status

The persistent authenticated workspace is implemented and now hosts `/dashboard`, `/customers`, `/branding`, and `/account` with one tenant identity, account control surface, responsive navigation model, branding boundary, active navigation behavior, and loading presentation.

## Security boundary

The shell is presentation, not authorization. `src/components/authenticated-application-shell.tsx` resolves the authenticated server session, revalidates the active organization context, reads authorization, and resolves tenant branding before passing safe display context into the client shell.

Protected pages still perform the server reads and permission checks required for their own data and mutations. Layout execution is not treated as a substitute for page/service authorization.

The active-organization cookie remains only a preference. Tenant access continues to be revalidated through the server tenant boundary.

## Navigation

Current navigation targets map only to implemented product surfaces:

- Dashboard — `/dashboard`
- Customers — `/customers`
- Branding — `/branding`
- Account and organization administration — `/account`

Do not add placeholder navigation for bookings, payments, inventory, availability, pricing, or integrations until those workflows exist.

Desktop uses a persistent left sidebar plus sticky tenant/account header. Mobile uses a compact fixed four-destination navigation surface with touch-sized targets. Both derive active navigation state from the current pathname and expose `aria-current`.

## Shared authenticated boundary

`AuthenticatedApplicationShell` is the canonical server wrapper for authenticated workspace routes. It centralizes:

- session enforcement and redirect behavior
- active-organization revalidation
- safe tenant identity for display
- current organization role for display
- active tenant branding resolution
- handoff into the client navigation shell

`ApplicationShell` supports both a semantic main wrapper and a neutral content wrapper so pages that already own their `<main>` landmark can be integrated without nested main landmarks.

## Tenant branding

When an active tenant has persisted white-label configuration, the shell supplies primary, secondary, accent, and font CSS variables at the workspace boundary. Shared components inherit those tokens rather than adding tenant-specific styles.

A configured tenant logo replaces the SF fallback mark. Authenticated route metadata can also use the configured favicon and tenant name. Branding remains tenant data resolved server-side; the client shell does not fetch or authorize branding by itself.

## Dashboard data

The dashboard remains operationally honest. It renders only persisted or server-derived information:

- active organization identity, kind, slug, timezone, and currency
- authenticated organization/platform role
- active and total membership counts only when the current actor has `membership:read`
- the current authenticated email and server-revalidated tenant/authorization status

It must not invent booking volume, revenue, conversion, occupancy, integration health, or other analytics before those domains exist.

## Operational module integration

The customer directory is the first operational module added to the shell. It uses the shared navigation/layout but independently enforces `customer:read` / `customer:manage` in its page and service boundaries.

`/account` preserves its existing server-side authentication, tenant revalidation, permission checks, organization switching, settings, lifecycle, and membership-management behavior inside the shared workspace.

`/branding` uses the same shell, including no-tenant/read-only/error states, without becoming the source of authorization truth.

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

## Integration rule

All new authenticated product modules must use the canonical workspace shell. Existing protected service boundaries remain authoritative for authentication, tenant scope, and authorization; the shell must never become the only security control.
