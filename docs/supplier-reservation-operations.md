# Supplier reservation operation ledger

## Purpose

SF treats an external supplier reservation as a commercial write whose outcome can become uncertain after network or provider failures. The supplier reservation operation ledger is the provider-neutral persistence and recovery boundary that must exist before any real supplier create call is exposed.

The ledger itself does not call Travelport, expose a browser route, or advertise reservation capability. A separate server-only Travelport known-locator recovery adapter is now implemented so provider truth can be read safely once an authoritative Travelport aggregator locator is known. Reservation creation remains closed.

## Data model and exact idempotency

`HospitalitySupplierReservationOperation` is tenant-owned and records one logical external reservation request. It stores organization/integration ownership and credential version, an organization-scoped idempotency key and SHA-256 request fingerprint, opaque supplier property/offer references, accepted offer and Rules fingerprints, a required reservation-payload fingerprint, exact currency/total/stay/occupancy, state, attempt count, normalized failure evidence, provider correlation evidence, and the confirmed provider reservation reference when one exists.

`HospitalitySupplierReservationAttempt` is append-only attempt history for create and reconciliation attempts. Database relationships enforce tenant-safe composite ownership.

An exact idempotency retry is accepted only when the persisted request fingerprint still matches the complete normalized commercial request. The ledger persists the reservation-payload fingerprint rather than traveler PII, card data, CVV, provider tokens, guarantee credentials, or raw provider request/response bodies.

The supplier operation remains separate from first-party `HospitalityBooking`; external supplier inventory does not fabricate local property, room type, rate plan, hold, or allocation identifiers.

## State and recovery contract

Operations use `PREPARED`, `SUBMITTING`, `CONFIRMED`, `AMBIGUOUS`, `RECONCILING`, and `FAILED`.

A create claim uses a serializable transaction plus a tenant/operation advisory lock and rechecks the active integration, provider code, exact credential version, and `reservation` capability. An ambiguous create cannot return directly to `PREPARED`; reconciliation must run first. Provider truth normalizes to:

- `FOUND` -> `CONFIRMED` with a persisted provider reservation reference;
- `NOT_FOUND` -> `PREPARED`, proving a later create attempt is safe;
- `UNKNOWN` -> `AMBIGUOUS`, keeping writes closed.

This prevents timeout/disconnect uncertainty from becoming a duplicate supplier reservation.

## Authorization and tenant isolation

Every operation validates organization/user UUIDs and requires server-side `booking:manage`. Tenant authority is established before reservation persistence. All reads are scoped by both operation ID and organization ID, and integration ownership is rechecked inside the same tenant.

The persistence coordinator never loads encrypted provider credentials or performs provider I/O. Provider transport stays behind integration/provider adapters.

Current Travelport configuration intentionally advertises only `availability`, `hotel-search`, and `pricing`. Because operation claims require `reservation`, the write state machine is not accidentally reachable by the current Travelport configuration.

## Known-locator Travelport recovery

`HospitalitySupplierReservationRecoveryProvider` defines a provider-neutral read-only recovery contract. The Travelport implementation uses the documented Hotel Retrieve endpoint with a known aggregator locator. A result is `FOUND` only when Travelport returns exactly one authoritative `sourceContext=Travelport` locator matching the requested value. An explicit known-locator HTTP 404 maps to `NOT_FOUND`; provider failures and malformed/mismatched responses fail closed.

The recovery adapter is loaded server-side with the active Travelport integration but does not persist state itself. A future reservation execution/reconciliation coordinator must decide when it is authorized to invoke provider recovery and must settle the result through the ledger under the existing tenant/idempotency locks.

Hotel Retrieve requires an aggregator locator. If a future create request becomes uncertain before SF receives that locator, this adapter cannot prove non-existence. Such an operation must remain `AMBIGUOUS` until a provisioned Travelport environment confirms a reliable provider-assisted lookup or other correlation mechanism. No source-only fallback is allowed to guess `NOT_FOUND`.

## Create-path authority remains unresolved

Travelport documents the reference Create Reservation SearchComplete identifier specifically as `propertyItems/lowestPublicAvailableRate/rateKey/value`. SF's pricing surface supports selecting normalized room/rate offers beyond only that lowest public rate. Therefore SF currently has **no** Travelport reservation POST and must not pass an arbitrary selected room-rate key as `CatalogOfferingIdentifier`.

The next create implementation must prove a documented exact-offer bridge or validate the provider semantics against Travelport non-production. It must also keep price/guarantee changes explicit: Travelport documents `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` as second-request decisions only after the initial request is stopped by a change.

## Database, audit, and privacy guarantees

Database checks cover organization idempotency, SHA-256 fingerprints, provider/currency/date/exact-money/occupancy bounds, tenant-safe integration and attempt ownership, confirmed-state provider-reference requirements, failed-state normalized evidence, bounded provider metadata, and unique provider reservation references within tenant/integration.

Audits record only operational facts needed to explain state transitions. Opaque offer/property references, provider locators/correlation values, fingerprints, traveler/customer data, card/payment material, credentials, tokens, and raw provider bodies are excluded from audit payloads and structured request logs.

## Validation

Dependency-free tests cover normalization, request fingerprinting, conflicts, ambiguous-state behavior, provider metadata bounds, tenant/authorization ordering, reservation-capability gating, serializable claims, reconciliation transitions, and audit privacy. A guarded PostgreSQL scenario covers exact retry, cross-tenant denial, ambiguous recovery, attempt ordering, confirmation, and credential-version invalidation when a disposable target is available.

The Travelport recovery suite additionally covers the fixed Hotel Retrieve endpoint, exact locator authority, 404 `NOT_FOUND`, mismatched provider truth, retryable failure normalization, authentication-cache eviction, unsafe input rejection, and a source contract that proves the adapter is read-only while `reservation` remains unadvertised.

## Next dependency

The next reservation dependency is the real single-room create authority and execution coordinator. It must establish a documented exact mapping from the selected SF offer to Travelport create authority, reconstruct only authorized traveler/guarantee/payment data, prove the persisted `reservationPayloadFingerprint`, claim the durable operation, classify every provider write outcome, and use known-locator recovery only when an authoritative locator exists.

Before `reservation` can be advertised, the create/retrieve identifiers, price/guarantee-change error contract, payment/guarantee payload, and locator-less ambiguity recovery strategy must be validated against a provisioned Travelport non-production account. Multi-room, modify, and cancel semantics remain separately verified capabilities rather than assumptions.
