# Integration Architecture

## Principle

SF owns a normalized internal domain. External services are implementations behind provider contracts.

```text
application
  ↓
domain
  ↓
provider contract
  ↓
adapters
  ├── internal inventory
  ├── GDS / supplier
  ├── payments
  ├── email
  └── SMS
```

Provider-specific response models and secrets must not leak into booking domain code.

## Capability model

Integration records advertise only capabilities they actually support. The current normalized capability vocabulary includes payment authorization/capture/refund, webhooks, search, availability, pricing, reservation, ticketing, modification, cancellation, and refunds. Unknown capability strings are rejected rather than silently accepted.

## Tenant configuration

`Integration` is now the tenant-owned configuration boundary. Each record stores organization scope, provider code, display name, enabled/disabled status, normalized capabilities, an encrypted credential envelope, and a monotonically increasing credential version. Provider code is unique per organization in the current foundation, so one active configuration exists per provider/tenant until a concrete multi-account requirement justifies a broader key model.

Credential plaintext is normalized and encrypted with AES-256-GCM before persistence. The envelope stores only version, IV, authentication tag, and ciphertext. The 32-byte master key comes exclusively from the deployment environment as `SF_INTEGRATION_MASTER_KEY`; it is never stored in an integration row. Credential reads returned to management callers intentionally omit both ciphertext and plaintext.

Only organization `ADMIN` currently receives `integration:manage`. `MANAGER` receives `integration:read`; staff and customers receive neither permission. Configuration, credential rotation, and disabling are audited without secret values.

The database model currently keeps `organizationId` as an indexed tenant scalar and every application read/write scopes by it. A Prisma-declared organization relation/database FK should be added when the root organization schema can be updated in the same validated migration pass; do not claim that database-level FK exists yet.

## Stripe wiring

`loadStripePaymentIntegration` resolves the active organization-scoped `stripe` integration, decrypts credentials only on the server, validates required credential names, and constructs `StripePaymentProvider`. This removes the need for committed/global Stripe secrets and gives the payment application layer a tenant-safe provider resolver without creating a fake checkout flow.

## Failure model

Adapters classify timeouts, authentication errors, rate limits, invalid requests, supplier outages, price changes, availability changes, partial failures, and duplicate callbacks into safe application-level errors. Integration configuration failures remain distinct from provider runtime failures.

## Validation

Focused unit tests cover authenticated encryption, tamper rejection, deployment master-key parsing, credential-shape limits, normalized capability/provider metadata, and ensuring public integration records cannot expose the encrypted credential field. The integration test glob is part of `npm test`.

The new schema/migration still requires `npm run prisma:validate`, migration deployment/drift checks, and disposable PostgreSQL execution before database validation can be claimed.
