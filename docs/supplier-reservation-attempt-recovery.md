# Supplier reservation attempt recovery

## Purpose

SF persists supplier reservation create and reconciliation claims before provider I/O. That is required for durable idempotency, but it creates a separate crash-recovery responsibility: a process can terminate after a claim becomes `SUBMITTING` or `RECONCILING` and before the matching attempt is settled.

A stranded in-flight state must never be interpreted as proof that the provider write did not happen. Retrying a stale create as if it were safely `PREPARED` could duplicate a real supplier reservation.

## Execution lease

Each current `STARTED` supplier reservation attempt has a fixed ten-minute execution lease. The lease is intentionally longer than the current supplier adapter request ceiling of 120 seconds and is not configurable by browser or tenant input.

The lease is a crash-detection guard, not a provider timeout and not reservation authority. Lease age is evaluated with PostgreSQL `clock_timestamp()` while the operation lock is held, so application-node clock skew cannot make a fresh claim look stale. Normal provider code must still use its bounded transport timeout and settle the durable attempt promptly.

Stale recovery is allowed only when all of these remain true under the same serializable operation lock used by the reservation ledger:

- the operation is `SUBMITTING` with a current `CREATE` attempt, or `RECONCILING` with a current `RECONCILE` attempt;
- the attempt is still `STARTED`;
- the attempt sequence exactly equals the operation `attemptCount`;
- the attempt start time is valid and at least ten minutes old.

A fresh attempt, mismatched kind, completed attempt, stale sequence, invalid timestamp, or operation outside the two in-flight states fails closed without mutation.

## Conservative recovery transition

An expired in-flight claim transitions to `AMBIGUOUS`, never to `PREPARED` or retryable `FAILED`.

The current attempt is completed as `AMBIGUOUS` with normalized failure code `EXECUTION_LEASE_EXPIRED`, and the operation records the same normalized failure. The transition does not invent provider truth or a provider reference.

This rule is deliberately conservative for both claim kinds:

- stale `CREATE` means SF cannot know whether the external reservation was created, so another create stays blocked until provider reconciliation proves the outcome;
- stale `RECONCILE` means the read/recovery coordinator itself stopped before recording its result, so the operation returns to `AMBIGUOUS` and reconciliation can be claimed again safely.

The recovery transition itself does not require provider I/O or encrypted credentials. A later reconciliation or create claim continues to enforce the existing active-integration, provider-code, credential-version, and `reservation` capability checks.

## Authorization, tenancy, and privacy

Recovery requires server-side `booking:manage` before transaction work begins. The operation and current attempt are both queried with the authenticated organization scope, and the transition executes inside a serializable transaction protected by the same tenant/operation PostgreSQL advisory-lock key used by normal supplier reservation claims.

Audit evidence records only the provider code, resulting state, attempt kind/sequence, and normalized `EXECUTION_LEASE_EXPIRED` failure code. Supplier property/offer references, provider reservation locators, correlation identifiers, traveler/customer data, reservation payload fingerprints, credentials, tokens, request/response bodies, and payment/card material are excluded.

## Validation

Dependency-free tests cover the fixed lease, the current-attempt/kind/sequence requirements, fresh-attempt rejection, and both create/reconciliation recovery paths. Source-contract tests cover authorization ordering, tenant-scoped reads, shared lock identity, fail-closed `AMBIGUOUS` transition, audit minimization, and registration in the disposable PostgreSQL suite.

The guarded PostgreSQL scenario covers fresh-lease rejection, Tenant A/Tenant B denial, stale create recovery, stale reconciliation recovery, attempt ordering, and safe reconciliation retry. It runs only through `npm run test:database` against an explicitly disposable PostgreSQL target.

## Remaining supplier-write boundary

This recovery slice strengthens the provider-neutral operation ledger but does not make Travelport reservation creation available. The real Travelport write remains blocked on provisioned non-production validation of the selected-offer authority bridge, a reviewed PCI-safe form-of-payment/guarantee strategy, the actual create coordinator, explicit price/guarantee-change handling, and verified locator-less ambiguous-write correlation/recovery.

See also:

- `docs/supplier-reservation-operations.md`
- `docs/travelport-stays-integration.md`
- `docs/integration-architecture.md`
