# Supplier reservation operation ledger

## Purpose

SF treats an external supplier reservation as a commercial write whose outcome can become uncertain after network or provider failures. The supplier reservation operation ledger is the provider-neutral persistence and recovery boundary that must exist before any real Travelport reservation create call is exposed.

This ledger does not create a booking, call Travelport, expose a browser route, or advertise reservation capability. It records the exact intent and the durable state required for a future provider adapter to perform and reconcile that write safely.

## Data model

`HospitalitySupplierReservationOperation` is tenant-owned and records one logical external reservation request. It stores:

- organization and integration ownership plus the integration credential version reviewed for the request;
- an organization-scoped idempotency key and SHA-256 request fingerprint;
- opaque supplier property and offer references;
- the accepted offer and Rules fingerprints;
- a required `reservationPayloadFingerprint` for the complete normalized traveler/guarantee/payment-token payload without persisting that raw payload in this ledger;
- exact currency/total, stay dates, and bounded occupancy;
- the operation state, attempt count, normalized failure evidence, provider correlation ID, and confirmed provider reservation reference when one exists.

`HospitalitySupplierReservationAttempt` is an append-only attempt history for create and reconciliation attempts. The database enforces tenant-safe composite ownership from each attempt to its operation.

The supplier operation is deliberately separate from `HospitalityBooking`. The current booking model represents first-party inventory with local property, room type, rate plan, hold, and allocation authority. SF does not fabricate local inventory identifiers for an external supplier reservation.

## Exact idempotency

The idempotency key is unique within an organization. An exact retry is accepted only when the persisted request fingerprint still matches the complete normalized request.

The request fingerprint covers provider code, opaque property/offer references, accepted offer fingerprint, accepted Rules fingerprint, `reservationPayloadFingerprint`, currency, exact total, dates, room/adult counts, and child ages. Reusing the same idempotency key with any changed commercial or reservation-payload evidence fails closed.

The ledger intentionally persists only the payload fingerprint, not traveler PII, card data, provider tokens, guarantee credentials, or other raw reservation request material. The future adapter must reconstruct its request from separately authorized product data and prove that the reconstructed normalized payload still hashes to the reviewed fingerprint before provider I/O.

## State and recovery contract

Operations use these states:

- `PREPARED`: durable intent exists and no provider create is currently in flight;
- `SUBMITTING`: a create attempt has been claimed exactly once;
- `CONFIRMED`: provider truth includes a persisted reservation reference;
- `AMBIGUOUS`: the create outcome cannot be proven and blind retry is forbidden;
- `RECONCILING`: provider-truth recovery is in progress;
- `FAILED`: a known create failure occurred; a new create attempt is allowed only when the normalized failure was explicitly classified retryable.

A create claim uses a serializable transaction plus a tenant/operation advisory lock. It also rechecks the active integration, provider code, exact credential version, and `reservation` capability. Configuration or credential changes therefore invalidate a prepared request until the user/commercial flow is reviewed again rather than silently sending stale evidence with new credentials.

An ambiguous create cannot return directly to `PREPARED`. Reconciliation must run first. Provider truth has only three normalized outcomes:

- `FOUND` -> `CONFIRMED` with a persisted provider reservation reference;
- `NOT_FOUND` -> `PREPARED`, proving a later create attempt is safe;
- `UNKNOWN` -> `AMBIGUOUS`, keeping writes closed.

This state machine prevents a timeout or disconnected response from becoming a duplicate reservation through an automatic retry.

## Authorization and tenant isolation

Every operation validates organization/user UUIDs and requires server-side `booking:manage`. Tenant authority is established before reservation persistence. All operation reads are scoped by both operation ID and organization ID, and integration ownership is rechecked within the same tenant.

The persistence coordinator never loads encrypted provider credentials and never performs provider I/O. Those remain future adapter responsibilities behind the integration/provider boundary.

Current Travelport Stays configuration intentionally advertises only `availability`, `hotel-search`, and `pricing`. Because the new claim boundary requires the real integration to advertise `reservation`, it is not accidentally reachable by the current Travelport configuration.

## Database guarantees

The migration adds database checks and indexes for:

- organization-scoped idempotency uniqueness;
- SHA-256 request/offer/Rules/payload fingerprints;
- provider/currency/date/exact-money/occupancy bounds, including child-age bounds;
- tenant-safe composite integration ownership;
- confirmed-state provider-reference requirements;
- failed-state normalized failure evidence;
- bounded single-line provider references/correlation IDs;
- unique tenant/integration provider reservation references;
- append-only attempt sequencing and tenant-safe attempt ownership.

These constraints are defense in depth. Application authorization, exact retry checks, state transitions, and provider-truth recovery remain server responsibilities.

## Audit and privacy boundary

Audits record only operational facts needed to explain state transitions: provider code, state, attempt sequence, credential version, normalized failure code, and retryability where applicable.

Opaque property/offer references, provider reservation references, provider correlation IDs, request fingerprints, reservation payload fingerprints, traveler/customer data, provider request/response bodies, credentials, tokens, and raw errors are excluded from audit payloads and structured request logs.

## Validation

Dependency-free tests cover normalization, exact request fingerprinting, conflict handling, ambiguous-outcome fail-closed behavior, provider metadata bounds, source-level tenant/authorization ordering, reservation-capability gating, serializable operation claiming, reconciliation transitions, and audit privacy. A guarded PostgreSQL integration scenario is checked in for exact retry, cross-tenant denial, ambiguous recovery, durable attempt ordering, confirmation, and credential-version invalidation.

The PostgreSQL integration scenario must run only through the repository's confirmed disposable database harness. Full Prisma migration/drift validation and the database scenario are not considered passed until that environment is available.

## Next dependency

The next reservation dependency is a real Travelport create-and-retrieve adapter for the already-proven single-room Rules boundary. It must map provider responses into this ledger, prove provider truth after ambiguous writes, keep price/guarantee changes explicit and fail-closed, and be validated against Travelport non-production credentials before SF advertises the `reservation` capability or exposes a reserve action.

Travelport's current Reservation Retrieve API is a multi-content booking retrieval surface and can return hotel offers that were booked through TripServices Stays. The implementation must verify the exact Travelport create/retrieve identifiers and recovery workflow against the provisioned Stays account rather than inferring them from successful Rules responses.
