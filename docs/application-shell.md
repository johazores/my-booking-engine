# Persistent Application Shell

## Status

The authenticated dashboard shell is implemented at `/dashboard` and is the canonical workspace foundation for new authenticated product surfaces.

## Security boundary

The shell is presentation, not authorization. `app/dashboard/layout.tsx` resolves the authenticated server session, revalidates the active organization context, and reads authorization before passing safe display context into the client shell. Dashboard data is independently protected in the page because layouts and pages may execute concurrently.

The active-organization cookie remains only a preference. Tenant access continues to be revalidated through the existing server tenant boundary.

## Navigation

Current real navigation targets are intentionally limited to implemented product surfaces:

- Dashboard — `/dashboard`
- Account and organization administration — `/account`

Do not add placeholder navigation for customers, bookings, payments, inventory, settings, or integrations until those workflows exist.

Desktop uses a persistent left sidebar plus sticky tenant/account header. Mobile uses a compact fixed navigation surface with touch-sized targets. Both derive active navigation state from the current pathname and expose `aria-current`.

## Dashboard data

The dashboard must remain operationally honest. It currently renders only persisted or server-derived information:

- active organization identity, kind, slug, timezone, and currency
- authenticated organization/platform role
- active and total membership counts only when the current actor has `membership:read`
- the current authenticated email and server-revalidated tenant/authorization status

It must not invent booking volume, revenue, conversion, occupancy, integration health, or other analytics before those domains exist.

## Accessibility and responsive behavior

The shell includes:

- skip-to-content navigation
- semantic primary and mobile navigation labels
- visible global focus states
- `aria-current` for active navigation
- responsive desktop/tablet/mobile layouts
- touch-sized mobile navigation
- loading feedback while session and tenant context resolve
- reduced-motion handling for the loading indicator

## Next integration rule

New authenticated product modules should be added under the dashboard workspace so they inherit the shell. Existing `/account` administration remains a real linked surface and can be migrated into the workspace only when doing so does not risk the already-completed organization/auth workflows.
