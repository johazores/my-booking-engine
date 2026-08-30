# Security

## Current baseline

- No secrets are committed and local environment files are ignored.
- Database access is server-only.
- User email identities are canonicalized before persistence and backed by database checks.
- Password credentials use versioned salted scrypt hashes; plaintext passwords are never persisted.
- Authentication sessions use random opaque tokens and PostgreSQL stores only SHA-256 token digests.
- Browser authentication uses HttpOnly, SameSite=Lax session cookies and `Secure` in production.
- Authentication mutations require exact same-origin form submissions and supported browser form media types.
- Session validity requires an unexpired, non-revoked session plus an `ACTIVE` user.
- Tenant organization lookup requires an active organization, active membership, and active user.
- Only `ACTIVE` memberships grant tenant access; invited, suspended, and archived memberships do not.
- Organization creation persists the organization and creator membership atomically.
- Active organization selection is stored only as an HttpOnly preference cookie and is revalidated against the authenticated user's membership on every context read.
- Database integration tests require a separate explicitly acknowledged disposable PostgreSQL target.
- Next.js removes the framework powered-by header.

## Authentication security

The production authentication strategy is documented in `docs/authentication.md` and the browser flow is implemented.

Passwords are not trimmed or normalized. The current policy requires 12–128 Unicode characters. The stored hash contains a random salt and versioned scrypt parameters so future rehashing can be introduced without changing the external authentication contract.

Raw session tokens are bearer secrets. They must exist only transiently in trusted server memory and the HttpOnly browser cookie. Never place a session token in a URL, JSON response, analytics payload, log, or audit event. PostgreSQL stores only the SHA-256 digest used for lookup.

A valid session does not imply tenant access. Every protected tenant operation must use the authenticated session user ID and then independently validate active organization membership, permissions, and resource ownership. Tenant/role claims must not be copied into a long-lived browser token where suspension could become stale.

## Tenant context security

The `sf_organization` cookie contains only the selected organization UUID. It is not an authorization token and must never be trusted by itself. Server code resolves it through the tenant-safe organization repository using the current authenticated user ID. Forged, stale, suspended, archived, deleted, or cross-tenant organization identifiers therefore resolve to no active tenant context.

The organization-selection POST endpoint validates authentication, exact same-origin submission, accepted form content type, identifier shape, and active membership before replacing the selected-organization cookie.

Creating a new organization is allowed for an authenticated active user because it creates a new tenant rather than mutating an existing one. The creator receives an active membership in the same database transaction. Management authority is intentionally not inferred from that membership; roles and permissions are the next dependency phase.

## Required application security

Protected operations must validate authentication, active user status, tenant membership, required permission, and resource ownership. Never rely on frontend navigation, route parameters, hidden controls, query strings, or client-side filtering for access control.

Suspending or archiving a user must remove tenant access even if an organization membership was not separately changed. Suspending or archiving a membership must also remove tenant access while leaving the user identity available for other organizations. Invited memberships never grant tenant access. Archived memberships are terminal in the current domain contract.

Membership mutation APIs remain intentionally unavailable until roles and permissions exist. Future membership writes must use explicit lifecycle transition rules in addition to checking actor authorization; raw client-supplied status changes are not an authorization or lifecycle boundary.

## Database test safety

`npm run test:database` is allowed only against an explicitly disposable PostgreSQL database. The runner requires `TEST_DATABASE_URL`, rejects reuse of `DATABASE_URL`, requires a named database, and requires `SF_DATABASE_TEST_CONFIRM=sf-disposable-test-database` before it validates/applies migrations or runs integration tests.

The database test path verifies Prisma schema validity, deploys checked-in migrations, verifies migration status, checks Prisma-supported schema drift, and runs tenant/authentication repository tests. Never weaken these guards to make local setup more convenient.

## Integration credentials

Future database-managed provider credentials must be encrypted before storage. Never store plaintext provider secrets, passwords, access tokens, payment card data, or session tokens in logs or audit records. The server-level master encryption key belongs in deployment secrets or a managed key service, never alongside encrypted credentials in the database.

## Payments

Payment success must be verified server-side from the provider. Browser redirects cannot be treated as proof of payment. Payment creation, capture, refunds, reconciliation, and webhooks should use idempotency strategies.

## Audit and observability

Important commercial operations should record actor, organization, action, resource, timestamp, and safe before/after information where appropriate. Structured logs may contain request/correlation ID, organization ID, provider, booking reference, and operation, but never passwords, API secrets, card data, access tokens, session tokens, or unnecessary encrypted credential payloads.
