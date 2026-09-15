# Integration configuration and lifecycle write scope

## Scope

This contract covers the tenant-owned `Integration` configuration, credential rotation/reconnection, enable, disable, and archive persistence boundary.

An integration is identified by its organization and provider, and mutable state also carries a lifecycle status plus a monotonically increasing credential version. Reads that establish authority are not sufficient on their own: every final mutation must repeat the server-validated tenant and the exact integration snapshot that justified the write.

## Final-write authority

`saveIntegration`, `enableIntegration`, `disableIntegration`, and `archiveIntegration` all require `integration:manage` before entering their persistence transaction. Existing records are loaded with organization scope. Every `Integration.update` then retains:

- the exact integration id;
- `organizationId`;
- the persisted provider code;
- the lifecycle status observed before the mutation; and
- the observed credential version.

The management writes run in serializable transactions. Prisma uniqueness/not-found/serialization conflicts are normalized to `IntegrationWriteConflictError`, which fails closed instead of allowing a stale lifecycle or credential decision to overwrite a newer one.

Credential rotation and archived-provider reconnection continue to increment `credentialVersion`. A stale rotation therefore cannot silently overwrite a credential set that another administrator rotated after the read. Enable/disable/archive do not increment the credential version, but they still require the observed version so a lifecycle action cannot be applied to credentials that changed concurrently.

## Lifecycle behavior

Sequential enable/disable/archive requests remain idempotent when the integration is already in the requested terminal state. Archive still requires `DISABLED`, purges encrypted credential ciphertext, preserves non-secret history, and requires complete fresh credentials before reconnection.

A concurrent conflicting mutation is different from an idempotent retry: it is rejected so the caller must operate from the latest tenant-owned state. The transaction that loses the race does not write its integration audit event.

## Tenant and secret boundaries

The database foreign key and unique tenant/provider key remain integrity backstops, not replacements for application authorization. Cross-tenant integration ids fail as unavailable before any mutation, and final write predicates repeat organization ownership.

Credential plaintext is encrypted before persistence, is never returned from management reads, and is not placed in audit payloads. Archive still removes only the encrypted credential envelope; provider identity, capabilities, credential version, ownership, timestamps, and audit history remain.

## Similar-issue sweep

The production `src/server` sweep found all direct `Integration.update` mutations in `src/server/integrations/integration-service.ts`. Configuration/rotation, enable, disable, and archive previously mutated by id after a tenant-scoped read. All four now retain the same tenant/provider/lifecycle/credential snapshot at the final write. ID-only `Integration.update` calls in guarded integration-test fixtures are test-state perturbations and are not production mutation boundaries.

Connection testing does not mutate the `Integration` row. It already rechecks tenant ownership, active status, and credential version before recording health evidence, so it remains outside this mutation change.

## Validation

`scripts/integration-write-scope.test.mjs` is a dependency-free source contract that guards the four final mutation predicates, serializable transaction boundary, conflict normalization, authorization, archive secret purge, and tenant-scoped active credential loading.

The checked-in disposable PostgreSQL integration suite remains the end-to-end authority for database ownership, lifecycle behavior, credential rotation, archive/reconnect behavior, secret-safe reads/audits, and future concurrency scenarios. Full repository validation still requires the repository Node 24 toolchain and an explicitly disposable PostgreSQL target.

GitHub Actions are intentionally not used.
