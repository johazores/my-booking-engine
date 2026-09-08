# Supplier reservation operation ledger

## Purpose

SF treats every external supplier reservation write as a commercial operation that may become uncertain after provider or network failure. `HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` are the provider-neutral persistence, idempotency, correlation, and crash-recovery boundary for those writes.

The ledger does not call Travelport or expose product routes. Provider-specific request/response behavior stays behind adapters and coordinators.

## Durable operation

`HospitalitySupplierReservationOperation` is tenant-owned and stores one logical external reservation request. It binds:

- organization and integration ownership;
- integration credential version;
- organization-scoped idempotency key;
- provider code and opaque supplier property/offer references;
- offer, Rules, reservation-authority, request, and reservation-payload fingerprints;
- exact currency/total/stay/occupancy;
- operation state and normalized failure evidence;
- bounded provider correlation/locator evidence when known;
- optional supplier confirmation; and
- optional provider-owned recovery authority.

Raw traveler PII, PAN/CVV, cardholder data, credentials, provider tokens, request bodies, and response bodies do not belong in this ledger.

External inventory remains separate from first-party `HospitalityBooking`; supplier operations never fabricate local property, room, rate-plan, hold, or allocation IDs.

## Attempt kinds

`HospitalitySupplierReservationAttempt` is append-only execution history. Attempt ownership is constrained to the same organization and reservation operation.

Current attempt kinds are:

- `CREATE` — an external supplier sell;
- `RECONCILE` — read-only provider truth lookup using a known provider locator;
- `RECOVERY_WRITE` — a provider-specific external recovery write such as Travelport Booking.com Sync.

`SUBMITTING` is the in-flight state for external writes (`CREATE` or `RECOVERY_WRITE`). `RECONCILING` is the in-flight state for `RECONCILE`.

## Exact idempotency and create retry

Create preparation generates request fingerprint v2 over the complete normalized commercial authority, including selected-offer Availability authority and the reservation-payload fingerprint.

A create may be claimed from `PREPARED`, or from a retryable `FAILED` state only when durable evidence proves the prior create never crossed the provider-request boundary. `AMBIGUOUS` can never be converted into another sell merely because a timeout occurred.

Legacy fingerprint versions fail closed and must be reviewed/prepared again before create.

A definitive Travelport price/guarantee no-sell response enters `REVIEW_REQUIRED`, not normal retry. Explicit accepted commercial evidence is revalidated and single-use; the reviewed second sell is consumed into exactly one new marked `CREATE` attempt while prior acceptance remains immutable history.

## Provider-request boundary and crash recovery

Every started attempt has a database-authored lease. Immediately before provider I/O, the provider-request boundary records `providerRequestStartedAt` under the tenant/operation advisory lock.

Before writing a new marker, SF rechecks that the operation's exact tenant integration is still `ACTIVE`, has the same provider and credential version, and still advertises `reservation`. This closes the window where an integration could be disabled or rotated after a claim/provider client was prepared but before transport begins. An already-written marker remains authoritative even if the integration changes later.

If a stale `CREATE` has no provider marker, it can return to `PREPARED` as retryable. If a stale `RECOVERY_WRITE` has no marker, it returns to `AMBIGUOUS` but is explicitly retryable because the recovery request itself never reached the provider. A stale `RECONCILE` returns to `AMBIGUOUS`.

Once any external-write provider marker exists, stale recovery remains ambiguous and cannot authorize replay.

See `docs/supplier-reservation-attempt-recovery.md`.

## Known-locator reconciliation

Automatic provider-neutral reconciliation is available only to an `AMBIGUOUS` operation with a known provider reservation locator.

The recovery adapter returns:

- `FOUND` — confirms only when the returned provider locator exactly matches the durable queried locator;
- `NOT_FOUND` — may return the operation to `PREPARED` only when the adapter has authoritative exact-locator negative semantics; or
- `UNKNOWN` — returns to `AMBIGUOUS` while preserving known locator and supplier-confirmation evidence.

A mismatched `FOUND` or `NOT_FOUND` cannot change retry authority.

The current Travelport Hotel Retrieve adapter does not interpret generic HTTP 404 as authoritative negative evidence because Travelport public documentation does not establish that semantic. Generic 404 therefore remains unknown/invalid, preserving the locator.

## Supplier confirmation and provider recovery evidence

A bounded supplier confirmation may be retained as lifecycle/recovery evidence. It does not by itself prove that a Travelport PNR exists and never authorizes another supplier sell.

For Travelport's documented Booking.com supplier-sold/no-PNR warning, the Create classifier can also stage a bounded opaque `providerRecoveryReference`. That reference contains only provider-owned non-secret recovery authority and is stored together with the supplier confirmation.

The separate `13034` timeout case does not create this authority because it cannot prove whether Booking.com sold the room.

## External recovery-write claim

`claimHospitalitySupplierReservationRecoveryWrite` is the provider-neutral claim for a provider-specific recovery write.

It requires:

- server-side `booking:manage`;
- exact tenant-owned operation;
- active integration with matching provider, credential version, and `reservation` capability;
- locator-less `AMBIGUOUS` state;
- supplier confirmation and provider recovery reference;
- the exact durable reservation-payload fingerprint; and
- no prior uncertain/marked `RECOVERY_WRITE`.

A prior recovery write can be attempted again only when it completed `FAILED`, has no provider-request marker, and the operation is explicitly retryable.

The claim moves the operation to `SUBMITTING` and appends a `RECOVERY_WRITE / STARTED` attempt.

## Recovery-write settlement

A recovery write confirms only when the provider-specific coordinator supplies a bounded provider reservation locator and the original supplier confirmation matches exactly.

Successful recovery:

- moves to `CONFIRMED`;
- stores the provider locator;
- preserves the verified supplier confirmation;
- clears `providerRecoveryReference`; and
- completes the recovery attempt as `SUCCEEDED`.

A pre-provider deterministic failure returns to `AMBIGUOUS`, preserves recovery evidence, and can be retryable only while `providerRequestStartedAt` is null.

Any post-marker uncertainty returns to `AMBIGUOUS`, preserves recovery evidence, and is not retryable.

## Travelport Booking.com Sync

`TravelportStaysReservationSyncExecutor` implements Travelport's fixed v11 `POST book/reservations/` Sync endpoint using retained recovery authority, the verified Booking.com confirmation/source, and the complete primary traveler identity/contact authority already bound to the durable reservation payload fingerprint.

`syncTravelportStaysBookingDotComReservation` rebinds the traveler fingerprint, claims `RECOVERY_WRITE`, reloads exact tenant integration authority, constructs the expected stay identity, completes OAuth before the provider marker, sends Sync only after the marker, and confirms only when the response proves:

- the exact durable property/stay/occupancy;
- the original Booking.com supplier confirmation; and
- exactly one Travelport locator.

The Sync path accepts no payment/card material. It remains server-only and unreachable while `reservation` capability is disabled.

See `docs/travelport-booking-sync-recovery-authority.md`.

## Authorization and tenant isolation

All supplier reservation claim/settlement/recovery services require server-side `booking:manage`. Reads and writes repeat organization scope and use tenant/operation advisory locks.

Provider-specific coordinators load credentials only through the tenant-owned active integration. External provider work rechecks provider code and credential version after durable claims, and the shared provider-request marker now repeats active integration/provider/credential/reservation-capability authority immediately before a new provider request is marked.

## Audit and privacy

Audit records contain only normalized transition facts such as provider code, state, attempt kind/sequence, retryability, and bounded failure code.

Supplier property/offer payloads, provider locators, supplier confirmations, recovery references, provider correlation values, traveler/customer data, fingerprints, payment/card data, credentials, tokens, and raw provider bodies are excluded from audit metadata.

Structured provider observations are similarly allowlisted and do not contain commercial or personal payloads.

## Validation

Dependency-free tests cover state/kind lease rules, request authority/idempotency, provider marker ordering and live integration revalidation, replay denial, Travelport Sync request construction, exact Sync confirmation matching, and privacy/source contracts.

Guarded PostgreSQL scenarios cover create/reconciliation persistence plus `RECOVERY_WRITE` behavior: pre-provider retry, marker-based retry denial, traveler fingerprint binding, exact supplier-confirmation confirmation, durable evidence preservation, and recovery-reference clearing on success.

Database tests run only through the explicitly disposable PostgreSQL harness. Live Travelport behavior remains unclaimed until provisioned non-production credentials are available.

## Activation boundary

Travelport `reservation` remains disabled. The server-only initial Create, explicit commercial review acceptance, reviewed second Create, Booking.com Sync recovery, durable idempotency/correlation, and known-locator Retrieve infrastructure are implemented.

Before external supplier reservations can be enabled SF still needs:

1. a concrete reviewed PCI-safe Create FormOfPayment/guarantee source appropriate for the provisioned Travelport account;
2. live SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery validation;
3. authoritative live `13034`, negative lookup, locator-less correlation, and retry/recovery semantics; and
4. complete customer/staff/API states only after capability activation.

Modification, cancellation, multi-room, refunds, and other lifecycle capabilities remain independent validation work.
