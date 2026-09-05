# Supplier reservation operation ledger

## Purpose

SF treats an external supplier reservation as a commercial write whose outcome can become uncertain after network or provider failures. The supplier reservation operation ledger is the provider-neutral persistence and recovery boundary that must exist before any real supplier create call is exposed.

The ledger itself does not call Travelport, expose a browser route, or advertise reservation capability. Server-only Travelport read adapters now cover known-locator recovery and exact selected-offer Availability authority review without making a provider write reachable. Reservation creation remains closed.

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

## Selected-offer Travelport authority review

`HospitalitySupplierReservationAuthorityProvider` defines a provider-neutral read-only review result. The Travelport implementation reuses current Rules/final offer revalidation, requires the accepted offer and terms fingerprints to remain current, then maps the exact selected SearchComplete rate to v11 Availability using the rate's `bookingCode`, optional rate-code filters, aggregator, property, dates, and occupancy.

All documented Availability continuation pages are consumed with a five-page / 500-offer bound. Stable totals and unique offer identifiers are required, and authority is accepted only when exactly one Availability offer maps to the selected rate. Because Travelport's `requestedCurrency` on Availability does not convert response amounts, the bridge does not reinterpret Availability money; exact commercial authority remains the already-verified SearchComplete + Rules evidence.

The result exposes only a deterministic SHA-256 `authorityFingerprint`. Expiring Availability identifiers and provider booking fields remain adapter-owned. The fingerprint is review evidence, not a timeless sell token: any future create executor must repeat the authority bridge immediately before the external write and bind that result to the persisted reservation request.

This closes the unsafe assumption that an arbitrary selected SearchComplete room-rate key can be used as the documented lowest-public-rate reference identifier. It does not open reservation capability.

## Known-locator Travelport recovery

`HospitalitySupplierReservationRecoveryProvider` defines a provider-neutral read-only recovery contract. The Travelport implementation uses the documented Hotel Retrieve endpoint with a known aggregator locator. A result is `FOUND` only when Travelport returns exactly one authoritative `sourceContext=Travelport` locator matching the requested value. An explicit known-locator HTTP 404 maps to `NOT_FOUND`; provider failures and malformed/mismatched responses fail closed.

The recovery adapter is loaded server-side with the active Travelport integration but does not persist state itself. A future reservation execution/reconciliation coordinator must decide when it is authorized to invoke provider recovery and must settle the result through the ledger under the existing tenant/idempotency locks.

Hotel Retrieve requires an aggregator locator. If a future create request becomes uncertain before SF receives that locator, this adapter cannot prove non-existence. Such an operation must remain `AMBIGUOUS` until a provisioned Travelport environment confirms a reliable provider-assisted lookup or other correlation mechanism. No source-only fallback is allowed to guess `NOT_FOUND`.

## Create-path payment boundary remains unresolved

Travelport's current public v11 Create Reservation full and reference payload contracts require traveler details plus form-of-payment and payment data. The documented card form sends `PaymentCard/CardNumber/PlainText`; security code is `SeriesCode/PlainText` for suppliers that require it, and Booking.com requires CVV.

SF's established online-payment contract never accepts raw card data. The supplier write path must not weaken that rule. Before a Travelport create adapter can be made reachable, SF needs a reviewed PCI-safe form-of-payment/guarantee strategy supported by the provisioned Travelport account, together with explicit handling for prepay/deposit/guarantee semantics.

Travelport also documents `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` as second-request decisions only after the initial request is stopped by a change. Those flags must never be included silently on the first create.

## Database, audit, and privacy guarantees

Database checks cover organization idempotency, SHA-256 fingerprints, provider/currency/date/exact-money/occupancy bounds, tenant-safe integration and attempt ownership, confirmed-state provider-reference requirements, failed-state normalized evidence, bounded provider metadata, and unique provider reservation references within tenant/integration.

Audits record only operational facts needed to explain state transitions. Opaque offer/property references, provider locators/correlation values, fingerprints, traveler/customer data, card/payment material, credentials, tokens, and raw provider bodies are excluded from audit payloads and structured request logs.

## Validation

Dependency-free tests cover normalization, request fingerprinting, conflicts, ambiguous-state behavior, provider metadata bounds, tenant/authorization ordering, reservation-capability gating, serializable claims, reconciliation transitions, and audit privacy. A guarded PostgreSQL scenario covers exact retry, cross-tenant denial, ambiguous recovery, attempt ordering, confirmation, and credential-version invalidation when a disposable target is available.

The Travelport read-side suites additionally cover bounded selected-offer Availability authority mapping/pagination and known-locator recovery. Source contracts prove the authority/recovery adapters are read-only while `reservation` remains unadvertised.

## Next dependency

The next reservation dependency is not a guessed POST. The selected-offer Availability bridge must first be validated against Travelport non-production, and SF must establish a PCI-safe form-of-payment/guarantee strategy for the provisioned account. Only then can a real single-room create adapter and execution coordinator be connected to this ledger.

That coordinator must repeat fresh offer/Rules/Availability authority immediately before create, bind the accepted authority to the durable request, reconstruct only authorized traveler/payment/guarantee material, classify every provider write outcome, and use known-locator recovery only when an authoritative locator exists. Locator-less ambiguity, explicit price/guarantee-change decisions, and provider correlation semantics still require live provider validation before `reservation` is advertised.

Multi-room, modify, and cancel semantics remain separately verified capabilities rather than assumptions.
