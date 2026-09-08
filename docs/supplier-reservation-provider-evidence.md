# Supplier reservation provider evidence

## Purpose

`HospitalitySupplierReservationAttempt` is the durable boundary between an SF execution claim and evidence that an external supplier request actually began. `providerRequestStartedAt` is therefore commercial safety evidence, not just observability metadata.

Application services already require the provider-request marker before accepting provider-derived outcomes. Migration `20260909035000_supplier-reservation-provider-evidence-guard` mirrors the same rules in PostgreSQL so a direct/internal write cannot manufacture provider truth while the durable ledger still says the provider boundary was never crossed.

## Database-enforced provider evidence

The database rejects these terminal attempt states when `providerRequestStartedAt` is null:

- `CREATE / SUCCEEDED`;
- `CREATE / REVIEW_REQUIRED`;
- `CREATE / AMBIGUOUS`;
- `RECONCILE / SUCCEEDED`;
- `RECONCILE / NOT_FOUND`;
- `RECOVERY_WRITE / SUCCEEDED`; and
- `RECOVERY_WRITE / AMBIGUOUS`.

These states either claim a successful provider action, a definitive provider truth result, a documented provider no-sell review outcome, or uncertainty after provider execution. They must never be persisted from pre-provider state.

## Deliberately allowed pre-provider states

The constraint does not treat every completed attempt as proof of provider I/O.

- `CREATE / FAILED` may be unmarked when deterministic validation, integration loading, authentication, request composition, or another pre-provider step fails. A marked `CREATE / FAILED` also remains possible when the provider returns a definitive no-sell validation response; retryability is still controlled by the normalized settlement contract.
- `RECONCILE / FAILED` may be unmarked for deterministic pre-provider failure.
- `RECONCILE / AMBIGUOUS` may be unmarked because provider-neutral `UNKNOWN` is also the fail-closed result when a read-side lookup never obtained authoritative provider truth.
- `RECOVERY_WRITE / FAILED` may be unmarked for deterministic pre-provider failure. Automatic recovery-write replay remains separately restricted to a failed, unmarked, explicitly retryable latest recovery attempt.
- `STARTED` may be marked or unmarked because it represents the in-flight boundary itself.

This distinction preserves safe pre-provider retry/recovery without allowing confirmed, review-required, definitive negative, or post-provider ambiguous evidence to appear from nowhere.

## Review-specific integrity

`REVIEW_REQUIRED` represents only the documented create-time price/guarantee no-sell family. PostgreSQL therefore also enforces that:

- `REVIEW_REQUIRED` belongs only to a `CREATE` attempt; and
- its normalized failure code is exactly `SUPPLIER_PRICE_CHANGED`, `SUPPLIER_GUARANTEE_CHANGED`, or `SUPPLIER_PRICE_AND_GUARANTEE_CHANGED`.

A reconciliation, recovery write, generic provider outage, timeout, or malformed response cannot be relabeled as commercial review authority by bypassing the service layer.

## Historical migration behavior

Older provider-derived attempts can predate `providerRequestStartedAt`. The migration first installs the new check as `NOT VALID`, which protects new/updated rows, then conservatively backfills only provider-derived terminal states whose marker is missing. The backfill uses the row's existing durable lease/start timestamp for both lease compatibility and provider-boundary evidence.

That timestamp is intentionally conservative. It means “this historical row must be treated as having crossed the provider boundary”; it does not claim to reconstruct the exact historical network-send instant. The constraint is validated only after this backfill.

Unexpected historical `REVIEW_REQUIRED` rows with the wrong attempt kind or wrong normalized review code are not silently rewritten. The migration fails closed during the protected backfill or subsequent constraint validation so inconsistent commercial evidence must be investigated instead of guessed.

## Authorization and tenant isolation

Database constraints are defense in depth. They do not replace server authorization or tenant scoping. Supplier reservation services still require `booking:manage`, organization-scoped operation/attempt reads and writes, current-attempt checks, the tenant operation advisory lock, active integration/provider/credential-version authority, and the `reservation` capability before provider work can begin.

## Validation

`npm test` includes a dependency-free source contract for the migration semantics. `npm run test:database` registers a guarded PostgreSQL scenario that attempts to bypass the service layer and verifies the database rejects unmarked provider-derived states, invalid review kinds, and invalid review reasons while continuing to allow legitimate pre-provider terminal states.

The guarded database suite must run only against an explicitly confirmed disposable PostgreSQL target. Until that environment is available, checked-in database behavior remains implemented but not live-validated.

See also:

- `docs/supplier-reservation-attempt-recovery.md`
- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-review-acceptance.md`
- `docs/gds-integration.md`
