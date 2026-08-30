# Security

## Current baseline

- No secrets are committed.
- Local environment files are ignored.
- Database access is server-only.
- Tenant organization lookup requires an active organization, active membership, and active user record.
- Tenant-owned membership reads reuse the same server-side principal eligibility rule.
- Next.js removes the framework powered-by header.

Authentication and full authorization are not implemented yet. Until authentication exists, repository callers must still supply a trusted server-derived user ID rather than accepting an arbitrary browser-provided identity.

## Required application security

Protected operations must validate authentication, active user status, tenant membership, permissions, and resource ownership. Never rely on frontend navigation or filtering for access control.

Suspending or archiving a user must remove tenant access even if an organization membership record was not separately changed yet. Suspending a membership must also remove tenant access while leaving the user identity intact for other organizations.

## Integration credentials

Future database-managed provider credentials must be encrypted before storage. Never store plaintext provider secrets, passwords, access tokens, or payment card data in logs or audit records.

The server-level encryption/master key belongs in deployment secrets or a managed key service, never in the same database record as encrypted credentials.

## Payments

Payment success must be verified server-side from the payment provider. Browser redirects cannot be treated as proof of payment. Payment creation, capture, refunds, reconciliation, and webhooks should use idempotency strategies.

## Audit history

Important operations should record actor, organization, action, resource, timestamp, and safe before/after information where appropriate. Credential values must never enter the audit trail.

## Observability

Structured logs may contain request/correlation ID, organization ID, provider, booking reference, and operation. They must not contain passwords, API secrets, card data, access tokens, or unnecessary encrypted credential payloads.
