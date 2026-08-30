# Organization Onboarding, Settings, and Lifecycle

## Implemented scope

Authenticated SF users can create an organization from `/account`. Creation is a server-side workflow: input is normalized and validated in the organization domain, then the organization, creator's `ACTIVE` membership with `ADMIN` role, and creation audit event are persisted atomically. Authentication never grants membership in an existing tenant.

Organization onboarding validates business name, canonical slug, supported business kind, IANA timezone, and three-letter currency code. A missing slug is derived from the business name. Unique slug conflicts are translated into safe user-facing feedback instead of exposing database details.

## Active organization selection

A user with multiple active organizations can select one from `/account`. The browser stores only the selected organization UUID in the `sf_organization` HttpOnly, SameSite=Lax cookie (`Secure` in production). The cookie is a preference, not an authorization claim.

Every read of active tenant context re-validates the cookie value through the tenant-safe organization repository using the authenticated session user ID. A forged, stale, suspended, archived, deleted, or cross-tenant organization ID therefore resolves to no active context. The selection POST endpoint also verifies authentication, exact same-origin submission, form media type, identifier shape, and active membership before setting the cookie.

Organization creation automatically selects the newly created organization only after the atomic organization + membership transaction succeeds.

## Organization settings

Organization settings are editable only by a platform administrator or an active tenant member with `organization-settings:manage`. The browser never supplies trusted actor or tenant authority; the actor comes from the validated session and the tenant comes from the revalidated active organization context.

The settings workflow validates and normalizes business name, slug, kind, timezone, and currency using the same domain rules as onboarding. Successful material changes are persisted transactionally and create an `organization.settings.updated` audit event containing only safe before/after organization metadata. Slug uniqueness conflicts return safe feedback.

## Safe deactivation

SF does not hard-delete organizations from the account workflow. A user with `organization:manage` can archive the active organization after typing its exact canonical slug.

Archival:

- changes status from `ACTIVE` to terminal `ARCHIVED`;
- sets `deletedAt`;
- preserves memberships and audit history;
- writes an `organization.archived` audit event;
- immediately removes the organization from active tenant queries;
- clears the browser's active-organization selection after success; and
- keeps the canonical slug reserved so historical identity is not silently reused.

The destructive write uses a serializable transaction and the existing organization lifecycle contract. Archived organizations are intentionally not restorable through the normal account UI.

## UX states

The account surface includes organization creation, selection, settings, and archive success/error feedback; active organization identity; invalid/stale selection feedback; labeled forms; responsive layout; keyboard-visible focus treatment; permission-aware controls; and an explicit typed confirmation for archival.

## Verification

The dependency-free organization-domain suite covers settings normalization and destructive confirmation behavior. The disposable PostgreSQL suite also includes organization-management integration coverage for cross-tenant permission denial, settings persistence, audit writes, confirmation failure, archival persistence, and removal from active tenant access.

Database-backed checks must only be claimed as passed after `npm run test:database` executes successfully against the guarded disposable PostgreSQL target.
