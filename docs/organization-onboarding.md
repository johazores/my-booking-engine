# Organization Onboarding and Active Tenant Context

## Implemented scope

Authenticated SF users can create an organization from `/account`. Creation is a server-side workflow: input is normalized and validated in the organization domain, then the organization and creator's `ACTIVE` membership are persisted atomically in one Prisma transaction. Authentication never grants membership in an existing tenant.

Organization onboarding currently validates business name, canonical slug, supported business kind, IANA timezone, and three-letter currency code. A missing slug is derived from the business name. Unique slug conflicts are translated at the repository/service boundary into safe user-facing feedback instead of exposing database details.

## Active organization selection

A user with multiple active organizations can select one from `/account`. The browser stores only the selected organization UUID in the `sf_organization` HttpOnly, SameSite=Lax cookie (`Secure` in production). The cookie is a preference, not an authorization claim.

Every read of active tenant context re-validates the cookie value through the tenant-safe organization repository using the authenticated session user ID. A forged, stale, suspended, archived, deleted, or cross-tenant organization ID therefore resolves to no active context. The selection POST endpoint also verifies authentication, exact same-origin submission, form media type, identifier shape, and active membership before setting the cookie.

Organization creation automatically selects the newly created organization only after the atomic organization + membership transaction succeeds.

## Authorization boundary

The creator currently receives an active membership but no implicit management role because roles and permissions are the next dependency phase. Tenant management writes must not be added until the permission model exists. Organization creation is allowed for an authenticated active user because it creates a new tenant owned by that new membership rather than mutating an existing tenant.

Future protected tenant routes must derive `userId` from the validated server session and `organizationId` from the revalidated active tenant context. Neither values submitted by the browser nor the organization cookie alone are sufficient authorization.

## UX states

The account surface includes organization creation success/error feedback, empty organization state, active organization identity, invalid/stale selection feedback, organization switching, labeled onboarding fields, responsive form layout, and keyboard-visible focus treatment.
