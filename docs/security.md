# Security

## Current baseline

- No secrets are committed.
- Local environment files are ignored.
- Database access is server-only.
- Tenant organization lookup is membership-scoped.
- Next.js removes the framework powered-by header.

Authentication and full authorization are not implemented yet.

## Required application security

Protected operations must validate authentication, tenant membership, permissions, and resource ownership. Never rely on frontend navigation or filtering for access control.

## Integration credentials

Future database-managed provider credentials must be encrypted before storage. Never store plaintext provider secrets, passwords, access tokens, or payment card data in logs or audit records.

The server-level encryption/master key belongs in deployment secrets or a managed key service, never in the same database record as encrypted credentials.

## Payments

Payment success must be verified server-side from the payment provider. Browser redirects cannot be treated as proof of payment. Payment creation, capture, refunds, reconciliation, and webhooks should use idempotency strategies.

## Audit history

Important operations should record actor, organization, action, resource, timestamp, and safe before/after information where appropriate. Credential values must never enter the audit trail.

## Observability

Structured logs may contain request/correlation ID, organization ID, provider, booking reference, and operation. They must not contain passwords, API secrets, card data, access tokens, or unnecessary encrypted credential payloads.
