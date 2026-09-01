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

`Integration` is the tenant-owned configuration boundary. Each record stores organization scope, provider code, display name, lifecycle status, normalized capabilities, an encrypted credential envelope while configured, a monotonically increasing credential version, and an archive timestamp when removed. Provider code is unique per organization in the current foundation, so one provider history record exists per provider/tenant until a concrete multi-account requirement justifies a broader key model.

Credential plaintext is normalized and encrypted with AES-256-GCM before persistence. The envelope stores only version, IV, authentication tag, and ciphertext. The 32-byte master key comes exclusively from the deployment environment as `SF_INTEGRATION_MASTER_KEY`; it is never stored in an integration row. Credential reads returned to management callers intentionally omit both ciphertext and plaintext.

Only organization `ADMIN` currently receives `integration:manage`. `MANAGER` receives `integration:read`; staff and customers receive neither permission. Configuration, credential rotation, enabling, disabling, archiving, reconnection, and explicit connection tests are audited without secret values.

Integration ownership is represented at both application and database layers. Prisma declares the `Integration.organization` / `Organization.integrations` relation, and migration `20260902033000_integration-organization-ownership` adds a restrictive foreign key from `integrations.organizationId` to `organizations.id`. Application reads and writes still scope by `organizationId`; the foreign key is an additional integrity boundary, not a replacement for server authorization.

### Lifecycle semantics

Disabling an integration preserves its encrypted credentials, capability configuration, provider identity, and credential version but prevents active credential loading. Re-enabling is a separate `integration:manage` operation that only changes the status back to `ACTIVE`; it does not decrypt, rewrite, or rotate stored credentials and therefore does not increment `credentialVersion`.

Both enable and disable are idempotent. Cross-tenant IDs fail closed as unavailable, and read-only managers cannot change lifecycle state.

Removal is implemented as audited archival rather than row deletion. An integration must be `DISABLED` before it can be archived, making removal an explicit two-step operation. Archival sets status to `ARCHIVED`, records `archivedAt`, permanently sets the stored encrypted credential envelope to `NULL`, and preserves provider identity, capability history, credential version, ownership, timestamps, and audit history. Repeating archive is idempotent and does not create duplicate audit events.

Archived records cannot be enabled or disabled and active credential loading always fails for them. Reconnection requires the administrator to submit a complete fresh credential set through `saveIntegration`; this replaces the purged credential envelope, increments the credential version, clears `archivedAt`, activates the integration, and records `integration.reconfigured`. Old credentials cannot be recovered or silently re-enabled after removal.

`saveIntegration` remains the credential configuration/rotation/reconnection path. Updating an active or disabled provider increments the credential version and activates it because new credential material is being persisted.

## Stripe wiring

`loadStripePaymentIntegration` resolves the active organization-scoped `stripe` integration, decrypts credentials only on the server, validates required credential names, and constructs `StripePaymentProvider`. This removes the need for committed/global Stripe secrets and gives the payment application layer a tenant-safe provider resolver without creating a fake checkout flow.

The authenticated `/integrations` management surface provides a Stripe-specific configuration form instead of a generic provider form. It never pre-fills or returns stored credentials. Saving the form replaces the complete encrypted Stripe credential set and activates the integration; lifecycle enable/disable remains a separate operation that does not rotate credentials. Webhook capability is only persisted when a webhook signing secret is supplied, so tenant configuration does not advertise verified webhook readiness when that secret is absent.

Read-only managers can inspect safe provider metadata, status, credential version, update/archive time, and capabilities, but they cannot submit credential, lifecycle, archive, or provider-test mutations. Staff/customer roles without `integration:read` receive no provider records. Other provider records, if present, are rendered without fake configuration controls until a real adapter-specific contract exists.

### Stripe connection testing

Organization administrators can explicitly test an active Stripe configuration from `/integrations`. The server revalidates `integration:manage`, resolves the active tenant-owned Stripe record, decrypts the secret key only after authorization, and performs Stripe's documented read-only `GET /v1/balance` request using that stored key. The response body is used only to verify that a successful response is a Stripe `balance` object; SF never returns or displays account balances, currencies, livemode metadata, provider error bodies, or credentials from this operation.

Connection results are normalized to `HEALTHY`, `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, or `INVALID_RESPONSE`. Network/timeout/provider failures are intentionally separated from invalid credentials so operators are not told to rotate a key when Stripe is merely unavailable. Disabled or archived integrations cannot be tested through the active-credential boundary.

Every explicit connection test writes a PII/secret-free `integration.connection-tested` audit event containing only provider code, normalized result, and credential version. A passing connection test proves that the stored secret key authenticated for that read-only Stripe API call at test time; it does not prove webhook delivery, payment capture, refund settlement, account compliance, or future provider availability.

## Failure model

Adapters classify timeouts, authentication errors, rate limits, invalid requests, supplier outages, price changes, availability changes, partial failures, and duplicate callbacks into safe application-level errors. Integration configuration failures remain distinct from provider runtime failures.

## Persistence verification

The guarded disposable-PostgreSQL suite includes integration persistence coverage. It verifies management permission denial, manager read-only access, Tenant A/Tenant B isolation, cross-tenant lifecycle/archive mutation denial, credential rotation, disable/load behavior, re-enable without credential rotation, archive preconditions, credential ciphertext purge, archived lifecycle lockout, idempotent archival, fresh-credential reconnection, secret-free public records/audit payloads, and rejection of an integration row whose `organizationId` has no parent organization.

The schema relation, foreign-key migration, archive migration, and integration test are checked in, but live database validation must not be claimed until `npm run test:database` runs against the explicitly confirmed disposable PostgreSQL target. That command performs Prisma validation, migration deployment/status/drift checks, and then executes the integration suite with the other persistence tests. GitHub Actions are intentionally not part of this process.

The Stripe connection probe has focused dependency-level coverage for its exact read-only request, successful response normalization, authentication failure, rate limiting, provider outage, malformed success payload, and network failure. The authenticated application-service/audit path still depends on the repository's database-backed integration suite for end-to-end persistence verification.

## Remaining management surface

The production Stripe management surface now covers tenant-scoped listing, initial configuration/credential rotation, enable/disable lifecycle control, explicit connection testing, safe two-step removal through credential-purging archival, and fresh-credential reconnection. Additional provider-specific configuration and health/test operations must be added only alongside real adapters and capability contracts.
