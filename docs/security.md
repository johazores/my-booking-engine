# Security

## Current baseline

- No secrets are committed.
- Local environment files are ignored.
- Database access is server-only.
- Tenant organization lookup requires an active organization, active membership, and active user record.
- Tenant-owned membership reads reuse the same server-side principal eligibility rule.
- Database integration tests require a separate PostgreSQL URL plus explicit disposable-database acknowledgement before migrations or repository tests run.
- Next.js removes the framework powered-by header.

Authentication and full authorization are not implemented yet. Until authentication exists, repository callers must still supply a trusted server-derived user ID rather than accepting an arbitrary browser-provided identity.

## Required application security

Protected operations must validate authentication, active user status, tenant membership, permissions, and resource ownership. Never rely on frontend navigation or filtering for access control.

Suspending or archiving a user must remove tenant access even if an organization membership record was not separately changed yet. Suspending a membership must also remove tenant access while leaving the user identity intact for other organizations.

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

Structured logs may contain request/correlation ID, organization ID, provider, booking reference, and operation. They must not contain passwords, API secrets, card data, access tokens, or unnecessary encrypted credential payloads.
