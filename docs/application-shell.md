# Persistent Application Shell

## Status

The persistent authenticated workspace hosts the implemented operational surfaces `/dashboard`, `/bookings`, `/invoices`, `/customers`, `/inventory`, `/pricing`, `/integrations`, `/branding`, and `/account` with one tenant identity, account control surface, responsive navigation model, branding boundary, and active navigation behavior.

## Security boundary

The shell is presentation, not authorization. `src/components/authenticated-application-shell.tsx` resolves the authenticated server session, revalidates the active organization context, reads authorization, and resolves tenant branding before passing safe display context into the client shell.

Protected pages still perform the server reads and permission checks required for their own data and mutations. Layout execution and navigation visibility are never substitutes for page/service authorization.

The active-organization cookie remains only a preference. Tenant access continues to be revalidated through the server tenant boundary.

## Navigation

Current navigation targets map only to implemented product surfaces:

- Dashboard — `/dashboard`
- Bookings — `/bookings`
- Tax invoices — `/invoices`
- Customers — `/customers`
- Inventory — `/inventory`
- Pricing — `/pricing`
- Integrations — `/integrations`
- Branding — `/branding`
- Account and organization administration — `/account`

The invoice destination is a real tenant-scoped issued-document register. Booking, invoice, customer, inventory, pricing, integration, branding, and account pages continue to enforce their own capability requirements server-side; a visible navigation item does not grant access.

Desktop uses a persistent left sidebar plus tenant/account header. Mobile uses the same implemented destinations in the responsive mobile navigation surface. Both derive active navigation state from the current pathname and expose `aria-current`.

Future modules must not be added to navigation until they have real persisted workflows and protected server boundaries.

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

It must not invent booking volume, revenue, conversion, occupancy, integration health, or other analytics that are not derived from implemented production data.

## Operational module integration

Operational modules reuse the same shell but retain independent authorization and persistence boundaries. Examples include:

- bookings and booking management with `booking:read` / `booking:manage`;
- issued tax-invoice register/detail/accounting export with `booking:read` plus `payment:read`, while issuance remains `payment:manage`;
- customer directory with `customer:read` / `customer:manage`;
- inventory, pricing, and integration modules with their corresponding capability checks; and
- account/branding administration with their existing tenant and management permissions.

`/account` preserves server-side authentication, tenant revalidation, permission checks, organization switching, settings, lifecycle, and membership-management behavior inside the shared workspace.

## Accessibility and responsive behavior

The workspace includes:

- skip-to-content navigation
- semantic primary and mobile navigation labels
- visible global focus states
- `aria-current` for active navigation
- responsive desktop/tablet/mobile layouts
- touch-oriented mobile navigation
- loading feedback while session, tenant context, and permissions resolve
- reduced-motion handling for loading indicators
- no nested `<main>` landmark when integrating pages that already provide their own main landmark

## Integration rule

All new authenticated product modules must use the canonical workspace shell. Existing protected service boundaries remain authoritative for authentication, tenant scope, and authorization; the shell must never become the only security control.
