# Supplier reservation attempt recovery

## Purpose

SF persists supplier reservation create and reconciliation claims before provider I/O. That is required for durable idempotency, but it creates a separate crash-recovery responsibility: a process can terminate after a claim becomes `SUBMITTING` or `RECONCILING` and before the matching attempt is settled.

A claim alone is not evidence that a provider request was sent. Treating every abandoned create claim as externally ambiguous can strand a reservation forever when the process actually died before provider I/O. Treating every abandoned claim as safely retryable is worse because it can duplicate a real supplier reservation after an uncertain provider write.

SF therefore records a separate durable provider-request boundary. Stale recovery may reopen a create only when the current attempt proves that boundary was never crossed.

## Two-stage execution lease

Each current `STARTED` supplier reservation attempt has a fixed ten-minute execution lease. The lease is intentionally longer than the current supplier adapter request ceiling of 120 seconds and is not configurable by browser or tenant input.

The lease is a crash-detection guard, not a provider timeout and not reservation authority. Its clocks are database-authored. A new claim receives `leaseStartedAt` from PostgreSQL `clock_timestamp()` with `providerRequestStartedAt = null`.

Immediately before provider transport can begin, server code must call `markHospitalitySupplierReservationProviderRequestStarted`. Under the same tenant/operation advisory lock, that marker:

- verifies `booking:manage`, organization scope, the in-flight operation, exact current attempt ID/sequence/kind, and `STARTED` status;
- records a database-authored `providerRequestStartedAt`;
- resets `leaseStartedAt` to that exact same database clock value so the external request receives a full execution lease;
- is idempotent after the first successful marker and does not keep extending the lease on repeated calls;
- writes only privacy-safe audit facts.

The marker must complete before the provider request. The marker and stale recovery use the same serializable operation lock, so they cannot race into contradictory authority. If stale recovery wins first, the attempt is no longer in flight and a later marker cannot authorize provider I/O. If the marker wins first, stale recovery sees durable evidence that provider I/O may have happened and fails closed to ambiguity.

The existing `startedAt` field remains operational history only and is not lease authority, so application-node clock skew cannot make a fresh claim look stale or postpone recovery indefinitely.

## Migration safety

The original lease migration conservatively gave attempts that were already `STARTED` a fresh database-authored lease rather than trusting historical application timestamps.

The provider-request-boundary migration is equally conservative. Existing `STARTED` attempts predate the new marker, so SF cannot prove they did not already reach an external provider. They are migrated with `providerRequestStartedAt` set and with a fresh `leaseStartedAt` from the same database clock. Completed historical attempts are not rewritten merely to fabricate provider-I/O history.

A database check requires any provider-request timestamp to have database lease authority and prevents the provider-request timestamp from preceding that lease timestamp.

## Stale recovery requirements

Stale recovery is allowed only when all of these remain true under the same serializable operation lock used by the reservation ledger:

- the operation is `SUBMITTING` with a current `CREATE` attempt, or `RECONCILING` with a current `RECONCILE` attempt;
- the attempt is still `STARTED`;
- the attempt sequence exactly equals the operation `attemptCount`;
- the database-authored lease start exists, is valid, and is at least ten minutes old.

A fresh attempt, missing lease authority, mismatched kind, completed attempt, stale sequence, invalid timestamp, or operation outside the two in-flight states fails closed without mutation.

## Recovery transitions

Recovery distinguishes whether durable provider-request evidence exists.

### Lease expired before provider request

When `providerRequestStartedAt` is still null, SF has durable evidence that the current execution never crossed the protected provider-request boundary.

For a stale `CREATE`:

- the operation returns to `PREPARED`;
- the attempt completes as `FAILED`;
- `lastFailureRetryable` is `true`;
- the normalized failure code is `EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST`;
- no provider reservation locator or provider truth is invented.

This is the only stale-create path that becomes safe to submit again, and it is safe only because the marker is mandatory before external provider I/O.

For a stale `RECONCILE`, the attempt completes as `FAILED` with the same pre-provider failure code, but the operation remains `AMBIGUOUS`. The reservation was already ambiguous before reconciliation began, so absence of a recovery lookup does not change supplier truth. A new reconciliation claim is safe when the known provider locator still exists.

### Lease expired after provider request may have started

When `providerRequestStartedAt` exists, the external request may have been sent even if the process died immediately after recording the marker. Recovery therefore remains conservative:

- the operation becomes or remains `AMBIGUOUS`;
- the attempt completes as `AMBIGUOUS`;
- the normalized failure code is `EXECUTION_LEASE_EXPIRED`;
- any known provider reservation locator is preserved;
- another create is never made safe by lease expiry alone.

This fail-closed rule applies to both create and reconciliation attempts.

## Existing reconciliation coordinator

The provider-neutral reconciliation coordinator now records the provider-request marker immediately before invoking `retrieveReservation`. Its durable request correlation remains the attempt UUID. Provider-code mismatch and other pre-provider rejection paths settle without pretending provider I/O occurred.

A future create coordinator must use the same marker immediately before its external reservation write. This document does not authorize a Travelport create call; it defines the crash-safe execution boundary that such a coordinator must honor once the remaining provider and payment prerequisites are satisfied.

## Authorization, tenancy, and privacy

Both provider-request marking and stale recovery require server-side `booking:manage` before transaction work begins. The operation and current attempt are queried with the authenticated organization scope, and every mutable attempt/operation write repeats that organization scope.

Both operations execute inside serializable transactions protected by the same tenant/operation PostgreSQL advisory-lock key used by normal supplier reservation claims.

Audit evidence records only provider code, operation state where relevant, attempt kind/sequence, whether provider request evidence existed, and normalized failure code. Supplier property/offer references, provider reservation locators, supplier confirmations, provider correlation identifiers, traveler/customer data, reservation payload fingerprints, credentials, tokens, request/response bodies, and payment/card material are excluded.

## Validation

Dependency-free tests cover the fixed lease, current-attempt/kind/sequence requirements, fresh-attempt rejection, pre-provider create retry safety, pre-provider reconciliation behavior, and fail-closed post-marker ambiguity for both attempt kinds.

Source-contract tests cover database-authored lease and provider-request clocks, conservative migration of legacy `STARTED` attempts, marker authorization and tenant/current-attempt scope, marker idempotency and lease refresh, recovery authorization ordering, shared lock identity, privacy-minimal audit data, and reconciliation marker ordering before provider I/O.

The guarded PostgreSQL scenario covers both sides of the boundary. It verifies that an expired create claim with no provider marker returns safely to `PREPARED`, can be claimed again, then becomes `AMBIGUOUS` after a provider marker is recorded and that refreshed lease expires. It also covers cross-tenant marker/recovery denial, idempotent markers, historical `startedAt` not controlling the lease, pre-provider reconciliation recovery, post-marker reconciliation ambiguity, locator preservation, attempt ordering, and safe reconciliation retry. It runs only through `npm run test:database` against an explicitly disposable PostgreSQL target.

## Remaining supplier-write boundary

This recovery slice strengthens the provider-neutral operation ledger but does not make Travelport reservation creation available. Travelport still advertises only read-side capabilities. The real Travelport write remains blocked on provisioned non-production validation of the selected-offer authority bridge, a reviewed PCI-safe form-of-payment/guarantee strategy, the actual create coordinator, explicit price/guarantee-change handling, authoritative negative lookup behavior, locator-less ambiguous-write recovery, and live provider verification.

See also:

- `docs/supplier-reservation-operations.md`
- `docs/travelport-stays-integration.md`
- `docs/integration-architecture.md`
