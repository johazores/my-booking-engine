# Security

## Current baseline

- No secrets are committed.
- Local environment files are ignored.
- Database access is server-only.
- Tenant organization lookup requires an active organization, active membership, and active user record.
- Tenant-owned membership reads reuse the same server-side principal eligibility rule.
- Membership lifecycle has an explicit terminal `ARCHIVED` state, and only `ACTIVE` memberships can satisfy tenant access scope.
- User email identities are canonicalized to trimmed lowercase values before persistence and are backed by database checks.
- Password credentials use versioned salted scrypt hashes; plaintext passwords are never persisted.
- Authentication sessions use cryptographically random opaque tokens and persist only SHA-256 token digests.
- Session validity requires an unexpired, non-revoked session plus an `ACTIVE` user, so user suspension removes authenticated access immediately.
- Database integration tests require a separate PostgreSQL URL plus explicit disposable-database acknowledgement before migrations or repository tests run.
- Next.js removes the framework powered-by header.

The authentication persistence/domain foundation exists, but browser sign-in/sign-up/sign-out routes, secure cookie delivery, and authenticated product UI are not complete yet. Until those HTTP flows exist, repository callers must still receive identity only from trusted server code rather than accepting an arbitrary browser-provided user ID.

## Authentication security

The production authentication strategy is documented in `docs/authentication.md`.

Passwords are not trimmed or normalized. The current policy requires 12–128 Unicode characters. The stored hash contains a random salt and versioned scrypt parameters so future rehashing can be introduced without changing the external authentication contract.

Raw session tokens are bearer secrets. They must exist only transiently in trusted server memory and the HttpOnly browser cookie. Never place a session token in a URL, JSON response, analytics payload, log, or audit event. PostgreSQL stores only the SHA-256 digest used for lookup.

A valid session does not imply tenant access. Every protected tenant operation must use the authenticated session user ID and then independently validate active organization membership, permissions, and resource ownership. Tenant/role claims must not be copied into a long-lived browser token where suspension could become stale.

## Required application security

Protected operations must validate authentication, active user status, tenant membership, permissions, and resource ownership. Never rely on frontend navigation or filtering for access control.

Suspending or archiving a user must remove tenant access even if an organization membership record was not separately changed yet. Suspending or archiving a membership must also remove tenant access while leaving the user identity intact for other organizations. Invited memberships never grant tenant access. Archived memberships are terminal in the current domain contract and must not be reactivated by future membership-management code.

Membership mutation APIs remain intentionally unavailable until roles and permissions exist. Future membership writes must call the explicit lifecycle transition rules in `src/server/memberships/membership-domain.ts` in addition to checking the actor's authorization; raw client-supplied status updates are not an acceptable authorization or lifecycle boundary.

Email is the authentication identifier and must be canonicalized through `createCanonicalUserEmail` before any user write. Do not perform ad-hoc lowercase handling in route handlers. The database rejects non-canonical or malformed email values, preventing casing/whitespace variants from bypassing the unique identity constraint. User lifecycle changes must use the explicit domain transition rules; archived identities are terminal in the current foundation.

## Database test safety

`npm run test:database` is allowed only against an explicitly disposable PostgreSQL database. The runner requires `TEST_DATABASE_URL`, rejects reuse of `DATABASE_URL`, requires a named database, and requires `SF_DATABASE_TEST_CONFIRM=sf-disposable-test-database` before it will validate/apply migrations or run integration tests. This acknowledgement is a guardrail, not permission to use production or shared data.

The database test path verifies Prisma schema validity, deploys checked-in migrations, verifies migration status, checks Prisma-supported schema drift, and then runs tenant-isolation repository tests. Never weaken these guards to make local setup more convenient.

## Integration credentials

Future database-managed provider credentials must be encrypted before storage. Never store plaintext provider secrets, passwords, access tokens, or payment card data in logs or audit records.

The server-level encryption/master key belongs in deployment secrets or a managed key service, never in the same database record as encrypted credentials.

## Payments

Payment success must be verified server-side from the payment provider. Browser redirects cannot be treated as proof of payment. Payment creation, capture, refunds, reconciliation, and webhooks should use idempotency strategies.

## Audit history

Important operations should record actor, organization, action, resource, timestamp, and safe before/after information where appropriate. Credential values must never enter the audit trail.

## Observability

Structured logs may contain request/correlation ID, organization ID, provider, booking reference, and operation. They must not contain passwords, API secrets, card data, access tokens, session tokens, or unnecessary encrypted credential payloads.
