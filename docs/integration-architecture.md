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

`Integration` is the tenant-owned configuration boundary. Each record stores organization scope, provider code, display name, enabled/disabled status, normalized capabilities, an encrypted credential envelope, and a monotonically increasing credential version. Provider code is unique per organization in the current foundation, so one active configuration exists per provider/tenant until a concrete multi-account requirement justifies a broader key model.

Credential plaintext is normalized and encrypted with AES-256-GCM before persistence. The envelope stores only version, IV, authentication tag, and ciphertext. The 32-byte master key comes exclusively from the deployment environment as `SF_INTEGRATION_MASTER_KEY`; it is never stored in an integration row. Credential reads returned to management callers intentionally omit both ciphertext and plaintext.

Only organization `ADMIN` currently receives `integration:manage`. `MANAGER` receives `integration:read`; staff and customers receive neither permission. Configuration, credential rotation, enabling, and disabling are audited without secret values.

Integration ownership is now represented at both application and database layers. Prisma declares the `Integration.organization` / `Organization.integrations` relation, and migration `20260902033000_integration-organization-ownership` adds a restrictive foreign key from `integrations.organizationId` to `organizations.id`. Application reads and writes still scope by `organizationId`; the foreign key is an additional integrity boundary, not a replacement for server authorization.

### Lifecycle semantics

Disabling an integration preserves its encrypted credentials, capability configuration, provider identity, and credential version but prevents active credential loading. Re-enabling is a separate `integration:manage` operation that only changes the status back to `ACTIVE`; it does not decrypt, rewrite, or rotate stored credentials and therefore does not increment `credentialVersion`.

Both enable and disable are idempotent. Repeating an operation when the record is already in the requested state returns the existing public record without creating a duplicate lifecycle audit event. Cross-tenant IDs fail closed as unavailable, and read-only managers cannot change lifecycle state.

`saveIntegration` remains the credential configuration/rotation path. Updating an existing provider through that path intentionally increments the credential version and activates the integration because new credential material is being persisted. A future management UI must keep the distinction between "enable existing configuration" and "rotate credentials" explicit.

## Stripe wiring

`loadStripePaymentIntegration` resolves the active organization-scoped `stripe` integration, decrypts credentials only on the server, validates required credential names, and constructs `StripePaymentProvider`. This removes the need for committed/global Stripe secrets and gives the payment application layer a tenant-safe provider resolver without creating a fake checkout flow.

## Failure model

Adapters classify timeouts, authentication errors, rate limits, invalid requests, supplier outages, price changes, availability changes, partial failures, and duplicate callbacks into safe application-level errors. Integration configuration failures remain distinct from provider runtime failures.

## Persistence verification

The guarded disposable-PostgreSQL suite includes integration persistence coverage. It verifies management permission denial, manager read-only access, Tenant A/Tenant B isolation, cross-tenant lifecycle mutation denial, credential rotation, disable/load behavior, re-enable without credential rotation, idempotent enable behavior, secret-free public records and audit payloads, and rejection of an integration row whose `organizationId` has no parent organization.

The schema relation, foreign-key migration, and integration test are checked in, but live database validation must not be claimed until `npm run test:database` runs against the explicitly confirmed disposable PostgreSQL target. That command performs Prisma validation, migration deployment/status/drift checks, and then executes the integration suite with the other persistence tests. GitHub Actions are intentionally not part of this process.

## Remaining management surface

The server foundation supports configuration/credential rotation, tenant-scoped listing, disabling, re-enabling without credential rotation, and active credential loading. A production management UI, explicit health/test operations, provider-specific configuration forms, and a safe remove/archive policy remain separate work. Stored secrets must never be returned to those interfaces.
