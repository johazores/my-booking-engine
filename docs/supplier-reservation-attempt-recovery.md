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
- rechecks that the operation's exact tenant integration is still `ACTIVE`, has the same provider and credential version, and still advertises `reservation` on every marker call, including an evidence replay;
- when the marker is not already present, writes database-authored `providerRequestStartedAt` and resets `leaseStartedAt` to the same database clock so the provider call receives a full lease;
- remains idempotent as a durable evidence mutation for non-transport callers and defensive ambiguity fallback;
- can require a fresh provider request, in which case an existing marker raises `HospitalitySupplierReservationProviderRequestAlreadyStartedError` before external I/O can be replayed; and
- audits only privacy-safe operational facts when the marker is first written.

The live-integration recheck happens after current-attempt validation and immediately before either a new marker is written or an existing marker is considered. This closes both the claim/load/OAuth window and the replay path where an integration could otherwise be disabled, rotated, or lose reservation capability while a prepared provider client still held older credentials.

Provider transport callbacks use `requireFreshProviderRequest: true`. An existing marker is therefore historical evidence only, never a reusable transport permit. Travelport initial Create and Booking.com Sync treat that replay conflict as post-marker uncertainty and settle the current attempt `AMBIGUOUS` rather than misclassifying it as a retry-safe pre-provider failure. Known-locator reconciliation similarly refuses to issue a second Retrieve for the same marked attempt. The reviewed second Create already has a separate atomic single-use boundary because accepted commercial consent is consumed into exactly one new marked attempt.

The marker and stale recovery share the same serializable operation lock. If recovery wins first, the attempt is no longer eligible for provider I/O. If the marker wins first, stale recovery must assume provider I/O may have occurred.

## Provider evidence settlement gate

The provider-request marker is also required before durable state can accept an outcome that itself claims provider execution or provider truth. This invariant is enforced inside the provider-neutral settlement transactions rather than trusted to each adapter coordinator.

- A current `CREATE` attempt may settle `CONFIRMED` or `AMBIGUOUS` only when `providerRequestStartedAt` exists. A deterministic pre-provider failure may still settle `FAILED` without the marker.
- A current `RECONCILE` attempt may settle definitive `FOUND` or `NOT_FOUND` truth only when the provider-request marker exists. Pre-provider validation or marker failure may still settle `UNKNOWN` without pretending that a provider lookup occurred.
- A current `RECOVERY_WRITE` attempt may settle `CONFIRMED` or `AMBIGUOUS` only when the provider-request marker exists. A deterministic pre-provider recovery-write failure may still settle `FAILED` without the marker.

This prevents a provider adapter, future coordinator, or direct internal caller from persisting a locator, confirmation, ambiguity, or definitive negative lookup as provider evidence when the durable ledger still proves that the provider boundary was never crossed.

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

The Travelport initial Create coordinator performs fresh offer/Rules/Availability/traveler/payment authority, claims a durable `CREATE` attempt, reloads the exact integration, acquires the ephemeral payment source, performs deterministic request validation/composition and OAuth, and then calls the provider-request marker with a fresh-request requirement. The marker rechecks the exact live integration under the operation lock and refuses an already-marked attempt before the commercial POST can begin.

The reviewed second Create is stricter still: its provider callback atomically rechecks the accepted commercial decision and live integration while consuming that decision into exactly one new marked `CREATE` attempt immediately before the POST.

The Travelport Booking.com Sync coordinator follows the shared provider-request boundary. It rebinds the authorized traveler fingerprint, claims `RECOVERY_WRITE`, reloads exact integration/credential authority, constructs the minimal Sync request, completes OAuth, requires a fresh provider-request marker, and only then calls `POST book/reservations/`.

Known-locator reconciliation requires the same fresh marker immediately before invoking provider Retrieve, so a disabled/rotated integration or an already-marked attempt cannot cross that read-side provider boundary.

## Authorization, tenancy, and privacy

Provider-request marking, stale recovery, recovery-write claim, and recovery-write settlement require server-side `booking:manage`. Every operation and attempt read/write is scoped by authenticated organization ID and uses the same tenant/operation advisory lock.

Audit records exclude supplier property/offer payloads, provider locators, supplier confirmations, recovery references, traveler/customer data, reservation fingerprints, credentials, tokens, request/response bodies, and payment/card material.

Travelport Create and Sync structured observations contain only attempt correlation UUID, organization UUID, fixed provider/operation, normalized result, duration, level, and timestamp.

## Validation

Dependency-free tests cover lease timing, state/kind matching, pre-provider retry safety, fail-closed post-marker ambiguity, live integration/provider/credential/capability authority, and the fresh-provider-request contract that prevents a durable marker from being reused as permission for second external I/O.

Source contracts verify authorization, tenant/current-attempt scope, shared lock identity, marker ordering, privacy-minimal audits, Travelport Create ordering, Travelport Sync recovery-write ordering, known-locator reconciliation ordering, reviewed second-Create single-use behavior, and the provider-evidence settlement gate for Create, reconciliation, and recovery writes.

Guarded PostgreSQL supplier-reservation scenarios are registered under `npm run test:database`. They require an explicitly disposable PostgreSQL target and remain part of the live database validation gate.

## Activation boundary

The Travelport initial Create, reviewed second Create, and Booking.com Sync server-side coordinators exist but remain unreachable because the integration does not advertise `reservation`. Activation still requires a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned account, live Travelport non-production end-to-end verification, live validation of the documented `13034` branches and external supplier-confirmation recovery path, verified locator-less/negative-lookup correlation behavior, and complete product/API states after those provider gates are proven.

See also:

- `docs/supplier-reservation-operations.md`
- `docs/travelport-booking-sync-recovery-authority.md`
- `docs/travelport-reservation-create-coordinator.md`
- `docs/travelport-stays-integration.md`
- `docs/integration-architecture.md`
