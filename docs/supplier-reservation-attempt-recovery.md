# Supplier reservation attempt recovery

## Purpose

SF persists supplier reservation external-work claims before provider I/O. The durable ledger currently has three attempt kinds:

- `CREATE` for a supplier sell;
- `RECONCILE` for a read-only provider-truth lookup using a known provider locator; and
- `RECOVERY_WRITE` for a provider-specific external recovery write such as Travelport Booking.com Sync.

A persisted claim alone does not prove that provider I/O occurred. SF therefore records a separate durable provider-request boundary so stale execution can distinguish work that is definitely safe to retry from work that may already have affected the supplier.

## In-flight operation states

`SUBMITTING` is the provider-neutral external-write state. It may have a current `CREATE` or `RECOVERY_WRITE` attempt.

`RECONCILING` is the read-only provider-truth state and must have a current `RECONCILE` attempt.

The attempt kind, sequence, operation state, and `STARTED` status must agree. Any mismatch fails closed.

## Two-stage execution lease

Every current `STARTED` supplier reservation attempt has a fixed ten-minute execution lease. The lease is longer than the current supplier adapter request ceiling and is a crash-detection guard, not a provider timeout or commercial authority.

Lease clocks are database-authored. A new claim receives `leaseStartedAt` from PostgreSQL `clock_timestamp()` with `providerRequestStartedAt = null`.

Immediately before provider transport can begin, server code calls `markHospitalitySupplierReservationProviderRequestStarted`. Under the same tenant/operation advisory lock, that marker:

- requires server-side `booking:manage`;
- validates organization scope, current operation, exact attempt ID and sequence, allowed attempt kind, and `STARTED` status;
- writes database-authored `providerRequestStartedAt`;
- resets `leaseStartedAt` to the same database clock so the provider call receives a full lease;
- is idempotent once written; and
- audits only privacy-safe operational facts.

The marker and stale recovery share the same serializable operation lock. If recovery wins first, the attempt is no longer eligible for provider I/O. If the marker wins first, stale recovery must assume provider I/O may have occurred.

## Stale recovery requirements

Recovery is allowed only when all of these remain true under the operation lock:

- the operation is `SUBMITTING` with a current `CREATE` or `RECOVERY_WRITE`, or `RECONCILING` with a current `RECONCILE`;
- the attempt is still `STARTED`;
- the attempt sequence equals the operation `attemptCount`;
- database lease authority exists; and
- the lease is at least ten minutes old.

Fresh attempts, missing lease authority, state/kind mismatch, completed attempts, stale sequences, invalid timestamps, and operations outside the two in-flight states fail closed.

## Recovery transitions before provider I/O

When `providerRequestStartedAt` is null, SF can prove the external provider boundary was not crossed.

For stale `CREATE`:

- operation returns to `PREPARED`;
- attempt becomes `FAILED`;
- `lastFailureRetryable=true`; and
- failure code is `EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST`.

For stale `RECOVERY_WRITE`:

- operation returns to `AMBIGUOUS`;
- supplier confirmation and provider recovery authority remain intact;
- attempt becomes `FAILED`;
- `lastFailureRetryable=true`; and
- failure code is `EXECUTION_LEASE_EXPIRED_BEFORE_PROVIDER_REQUEST`.

The operation stays ambiguous because the original supplier sell was already ambiguous. A new recovery write is safe only because durable evidence proves the recovery request itself never reached the provider.

For stale `RECONCILE`:

- operation returns to `AMBIGUOUS`;
- attempt becomes `FAILED`;
- the same pre-provider failure code is recorded; and
- no retryability claim is made about the supplier sell.

A known-locator reconciliation can be claimed again because the lookup itself is read-only and the durable provider locator remains available.

## Recovery transitions after provider I/O may have started

When `providerRequestStartedAt` exists, the external request may have been sent. For `CREATE`, `RECONCILE`, and `RECOVERY_WRITE`:

- operation becomes or remains `AMBIGUOUS`;
- attempt becomes `AMBIGUOUS`;
- failure code is `EXECUTION_LEASE_EXPIRED`; and
- `lastFailureRetryable` is null.

This prevents lease expiry from authorizing a duplicate supplier sell or a repeated external recovery write.

## Recovery-write replay boundary

A provider-neutral recovery-write claim accepts only a locator-less `AMBIGUOUS` operation with a supplier confirmation and provider recovery reference. It also binds the caller to the durable reservation payload fingerprint and exact tenant/integration/credential-version authority.

If the most recent attempt is `RECOVERY_WRITE`, another claim is allowed only when that attempt is `FAILED`, `providerRequestStartedAt` is null, and the operation is explicitly marked retryable. Any marked, ambiguous, successful, or otherwise uncertain recovery write blocks automatic replay.

Successful recovery clears the provider recovery reference and confirms only with matching supplier confirmation plus a provider reservation locator. An ambiguous recovery retains its evidence but is not automatically retryable.

## Coordinator ordering

The Travelport Create coordinator performs deterministic request validation/composition and OAuth before the provider-request marker, then sends the commercial Create Reservation POST only after the marker succeeds.

The Travelport Booking.com Sync coordinator follows the same write boundary. It rebinds the authorized traveler fingerprint, claims `RECOVERY_WRITE`, reloads exact integration/credential authority, constructs the minimal Sync request, completes OAuth, records the provider-request marker, and only then calls `POST book/reservations/`.

Known-locator reconciliation records the marker immediately before invoking the provider Retrieve operation.

## Authorization, tenancy, and privacy

Provider-request marking, stale recovery, recovery-write claim, and recovery-write settlement require server-side `booking:manage`. Every operation and attempt read/write is scoped by authenticated organization ID and uses the same tenant/operation advisory lock.

Audit records exclude supplier property/offer payloads, provider locators, supplier confirmations, recovery references, traveler/customer data, reservation fingerprints, credentials, tokens, request/response bodies, and payment/card material.

Travelport Create and Sync structured observations contain only attempt correlation UUID, organization UUID, fixed provider/operation, normalized result, duration, level, and timestamp.

## Validation

Dependency-free tests cover lease timing, state/kind matching, pre-provider retry safety, and fail-closed post-marker ambiguity, including `RECOVERY_WRITE`.

Source contracts verify authorization, tenant/current-attempt scope, shared lock identity, marker ordering, privacy-minimal audits, Travelport Create ordering, and Travelport Sync recovery-write ordering.

A guarded PostgreSQL recovery-write scenario is registered under `npm run test:database`. It verifies pre-provider recovery retry, provider-marked non-retryability, replay prevention after ambiguous Sync, traveler fingerprint binding, matching supplier-confirmation settlement, and recovery-reference clearing on success. It requires an explicitly disposable PostgreSQL target.

## Activation boundary

The Travelport Create and Booking.com Sync server-side coordinators exist but remain unreachable because the integration does not advertise `reservation`. Activation still requires live Travelport non-production verification, a reviewed PCI-safe Create form-of-payment strategy, explicit price/guarantee-change acceptance, authoritative `13034`/negative-correlation semantics, and complete product/API states.

See also:

- `docs/supplier-reservation-operations.md`
- `docs/travelport-booking-sync-recovery-authority.md`
- `docs/travelport-reservation-create-coordinator.md`
- `docs/travelport-stays-integration.md`
- `docs/integration-architecture.md`
