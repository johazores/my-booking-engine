# Stripe commercial amendment recovery write scope

Expired hospitality commercial amendments can own real provider money after the normal amendment apply window has ended. The recovery executor, customer-authorized recovery Checkout, polling reconciliation, and signed Stripe webhooks therefore use a defense-in-depth persistence boundary: the final database mutation must retain the same tenant, booking, amendment, operation identity, lifecycle state, provider reference, settlement source, currency, and exact minor-unit amount that were validated before provider truth was accepted.

This contract strengthens the final Prisma write boundary. It does not replace the existing authorization, advisory-lock, serializable-transaction, idempotency, provider-reconciliation, or recovery-decision checks.

## Payment mutation invariant

A recovery-owned `PaymentTransaction` update must not fall back to an ID-only predicate after an earlier tenant-scoped read. The final predicate retains, as applicable:

- `organizationId`
- `bookingId`
- `commercialAmendmentId`
- deterministic `idempotencyKey`
- persisted `requestFingerprint`
- Stripe `providerCode`
- operation `kind`
- expected prior `status`
- the previously validated `providerReference`
- the previously validated `sourceProviderReference`, including explicit `null` for source-less compensation captures
- exact `currency`
- exact `amountMinor`

The direct recovery executor centralizes this predicate so authorization release, non-retryable claim failure, provider-result persistence, and polling reconciliation share the same boundary. Recovery Checkout claim failure, Session binding, and Session reconciliation enforce the same identity directly at their final writes.

Changing a Checkout Session reference to its returned PaymentIntent or an internal refund claim to a Stripe refund reference is allowed only when the predicate still matches the old persisted provider reference. This prevents a provider result from being rebound to a different recovery operation between validation and mutation.

## Verified webhook ledger identity

Signed recovery Checkout and direct recovery webhooks preserve verified webhook ledger identity at the final `PaymentWebhookEvent` mutation. The write retains the event row ID together with:

- `organizationId`
- Stripe `providerCode`
- `providerEventId`
- `eventType`
- the SHA-256 `payloadHash` that was verified before finalization

The same callback transaction also retains the complete recovery payment identity before changing payment status or provider reference. Recovery webhook timestamps use the same validated `now` value that drove expiry and provider-state checks rather than introducing a second wall-clock read during persistence.

## Preserved architecture boundaries

Provider-specific calls remain behind the existing Stripe adapters. The provider-neutral recovery decision remains the authority for whether recovery must wait, release authorization, capture compensation, refund compensation, request fresh customer authority, or close the amendment. The booking commercial snapshot is not rewritten by these persistence guards; successful compensation returns authoritative settlement to the immutable pre-amendment total and the shared recovery finalizer owns terminal amendment closure and target-hold release.

Browser redirects remain UI state only. Signed callbacks and explicit provider reconciliation remain provider truth. Existing `booking:manage` plus `payment:manage` authorization, booking/payment advisory locks, serializable database transactions, deterministic idempotency, exact-money checks, duplicate provider-reference checks, and audit evidence remain required.

## Similar-issue boundary

This review covers the expired Stripe commercial-amendment recovery family: direct release/capture/refund recovery, customer-authorized recovery Checkout, Checkout polling, Checkout webhook finalization, and direct recovery webhook finalization. Normal commercial-amendment preparation/apply mutations and unrelated booking/payment lifecycles have different acceptance criteria and are not mechanically rewritten by this contract.

## Validation

`scripts/stripe-commercial-amendment-recovery-write-scope.test.mjs` is a dependency-free source contract that guards the recovery executor helper, recovery Checkout writes, polling reconciliation, both signed webhook families, verified webhook ledger identity, and the architecture boundaries documented above.

The source contract can run without a database, but it does not replace repository validation. Full Node 24 / TypeScript validation, Prisma validate/generate, migrations and drift checks, production build, PostgreSQL locking/concurrency scenarios, and live Stripe recovery verification remain required when those environments are available. No database or provider check is considered passed merely because the dependency-free source contract passes.

GitHub Actions are intentionally not used for this repository. Validation for this boundary must use local/manual repository commands and explicitly disposable infrastructure where database execution is required.
