# Supplier reservation operation ledger

## Purpose

SF treats an external supplier reservation as a commercial write whose outcome can become uncertain after network or provider failures. The supplier reservation operation ledger is the provider-neutral persistence and recovery boundary required before any real supplier create call is exposed.

The ledger itself does not call Travelport, expose a browser route, or advertise reservation capability. Travelport read adapters cover exact selected-offer Availability authority and known-locator Hotel Retrieve. A provider-neutral reconciliation coordinator now connects the recovery adapter to the durable ledger, but it remains unreachable for Travelport until the integration deliberately advertises `reservation` after the real create/recovery contract is validated.

## Data model and exact idempotency

`HospitalitySupplierReservationOperation` is tenant-owned and records one logical external reservation request. It stores organization/integration ownership and credential version, an organization-scoped idempotency key, opaque supplier property/offer references, accepted offer and Rules fingerprints, request fingerprint v2 bound to selected-offer reservation authority, a reservation-payload fingerprint, exact currency/total/stay/occupancy, state, normalized failure evidence, bounded provider correlation evidence, the Travelport/aggregator reservation reference when known, and an optional supplier confirmation reference after confirmation.

`HospitalitySupplierReservationAttempt` is append-only history for create and reconciliation attempts. Composite relationships keep attempt ownership inside the same organization.

An exact idempotency retry is accepted only when the persisted request fingerprint matches the complete normalized commercial request. Request fingerprint v2 includes the reviewed reservation-authority fingerprint, accepted offer/Rules evidence, and reservation-payload fingerprint. Raw authority identifiers, traveler PII, card data, CVV, credentials, provider tokens, guarantee material, and raw provider request/response bodies are not persisted in this ledger.

The supplier operation remains separate from first-party `HospitalityBooking`; external inventory does not fabricate local property, room type, rate plan, hold, or allocation identifiers.

## State and recovery contract

Operations use `PREPARED`, `SUBMITTING`, `CONFIRMED`, `AMBIGUOUS`, `RECONCILING`, and `FAILED`.

A create claim runs in a serializable transaction under a tenant/operation advisory lock and rechecks the active integration, provider code, exact credential version, and `reservation` capability. A create claim is allowed only for request fingerprint v2. An ambiguous create can optionally retain a known provider reservation locator when the provider write produced that durable evidence even though the overall outcome was not safe to call confirmed.

Automatic reconciliation is permitted only for `AMBIGUOUS` operations that already have a known provider reservation locator. Locator-less ambiguity stays `AMBIGUOUS`; SF must not invent `NOT_FOUND` or retry the external create blindly. Known-locator provider truth normalizes to:

- `FOUND` -> `CONFIRMED`, but only when the returned provider locator exactly matches the stored known locator. Any normalized supplier confirmation reference is persisted atomically with confirmation.
- `NOT_FOUND` -> `PREPARED`, but only when the recovery result explicitly identifies the exact locator that SF queried; provider and supplier confirmation references are then cleared because provider truth established that this known locator does not resolve to a reservation.
- `UNKNOWN` -> `AMBIGUOUS`; the known provider locator is preserved so a transient provider failure cannot destroy the authority required for another recovery attempt.

Both `FOUND` and `NOT_FOUND` are therefore identity-bound to the durable queried locator before either result can change retry safety. A recovery adapter that returns provider truth for a different locator is normalized to `UNKNOWN` with `INVALID_RESPONSE`; the operation returns to `AMBIGUOUS` and keeps the original locator. A mismatched `NOT_FOUND` can never make another supplier create retryable.

This prevents timeout/disconnect uncertainty from becoming a duplicate supplier reservation and fixes the prior unsafe behavior where an `UNKNOWN` reconciliation could erase the only known provider locator.

`requestFingerprintVersion` remains nullable only as migration evidence for rows created before selected-offer Availability authority was included in the digest. A legacy `PREPARED` or retryable `FAILED` operation fails closed at create claim and must be reviewed/prepared again. A legacy `AMBIGUOUS` operation can still be reconciled when it has an authoritative provider locator.

## Provider-neutral reconciliation coordinator

`reconcileHospitalitySupplierReservationWithProvider` is the server-only coordinator between the ledger and `HospitalitySupplierReservationRecoveryProvider`. The ledger claim runs first, so server-side `booking:manage`, tenant scope, current operation state, integration ownership, credential version, and `reservation` capability are verified before any provider I/O.

The coordinator rejects provider-code mismatch without calling the provider, invokes only the provider-neutral `retrieveReservation` contract, requires every returned `FOUND` or `NOT_FOUND` result to identify the exact locator that was queried, and settles every normalized result through the ledger. Locator mismatches settle as `UNKNOWN` / `INVALID_RESPONSE` rather than leaving a reconciliation claim stuck or allowing an unrelated `NOT_FOUND` result to reopen create. `HospitalitySupplierProviderError` codes are persisted only as normalized failure codes; unexpected adapter failures become `PROVIDER_UNAVAILABLE`. Error messages, raw payloads, credentials, tokens, and transport details are not copied to ledger or audit data.

This coordinator does not load credentials itself and does not create a reservation. Provider-specific transport remains behind integration/provider adapters.

## Authorization and tenant isolation

Every operation validates organization/user UUIDs and requires server-side `booking:manage`. Tenant authority is established before persistence or provider recovery. Operation reads are scoped by both operation ID and organization ID, and integration ownership is rechecked inside the same tenant.

The guarded database scenario also verifies that a different tenant cannot cause the coordinator to call the recovery provider for another organization's operation.

Current Travelport configuration intentionally advertises only `availability`, `hotel-search`, and `pricing`. Because create and reconciliation claims require `reservation`, the commercial write/recovery state machine is not accidentally reachable by the current Travelport configuration.

## Selected-offer Travelport authority review

`HospitalitySupplierReservationAuthorityProvider` defines a provider-neutral read-only review result. The Travelport implementation reuses current Rules/final offer revalidation, requires the accepted offer and terms fingerprints to remain current, then maps the exact selected SearchComplete rate to v11 Availability using provider-owned booking/rate evidence.

All documented Availability continuation pages are consumed with a five-page / 500-offer bound. Stable totals and unique offer identifiers are required, and authority is accepted only when exactly one Availability offer maps to the selected rate. Because Travelport's `requestedCurrency` on Availability does not convert response amounts, exact commercial authority remains the verified SearchComplete + Rules evidence.

The result exposes only a deterministic SHA-256 `authorityFingerprint`. Expiring Availability identifiers remain adapter-owned. Preparing a supplier reservation includes that fingerprint in request fingerprint v2 without persisting Travelport booking identifiers or the authority fingerprint itself.

The fingerprint is review evidence, not a timeless sell token. A future create executor must repeat the authority bridge immediately before the external write and require the freshly recomputed request fingerprint v2 to match the durable operation.

## Known-locator Travelport recovery

`HospitalitySupplierReservationRecoveryProvider` is provider-neutral. `TravelportStaysReservationRecoveryProvider` uses Hotel Retrieve with a known aggregator locator. `FOUND` requires exactly one authoritative `sourceContext=Travelport` locator matching the requested locator; an optional single supplier confirmation can accompany it. Explicit HTTP 404 maps to `NOT_FOUND` for the exact requested locator; authentication, rate-limit, timeout, provider-unavailable, malformed, duplicated, or mismatched responses fail closed.

The provider-specific adapter never persists state itself. The coordinator claims and settles the ledger around the adapter call, preserving tenant authorization and durable state semantics.

Hotel Retrieve still requires an aggregator locator. If a future create becomes uncertain before SF receives one, the current public Retrieve contract cannot prove provider truth. The operation must remain `AMBIGUOUS` until provisioned Travelport validation/provider support establishes a reliable correlation-assisted lookup or another authoritative mechanism.

## Supplier confirmation evidence

Travelport reservation responses can contain a supplier confirmation locator in addition to the Travelport aggregator locator. SF now stores that optional supplier confirmation only on a `CONFIRMED` operation and only after the same single-line bounded normalization used for operational provider references.

The field is lifecycle evidence for future provider operations; it does not by itself authorize cancellation. Cancellation still requires a separately verified provider contract, server-side authorization, write idempotency/recovery, and live non-production validation before any capability or UI is exposed.

## Create-path payment boundary remains unresolved

Travelport's public v11 Create Reservation full/reference payload contracts require traveler details plus form-of-payment/payment data. The documented card form includes PAN and may require security code for some suppliers.

SF's established online-payment contract never accepts raw card data. The supplier write path must not weaken that rule. Before a Travelport create adapter can be made reachable, SF needs a reviewed PCI-safe form-of-payment/guarantee strategy supported by the provisioned Travelport account and explicit handling for prepay/deposit/guarantee semantics.

Travelport documents `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` as explicit follow-up decisions after an initial request is stopped by a change. SF must never silently include those flags on the first create.

## Database, audit, and privacy guarantees

Database checks cover organization idempotency, request/offer/terms/payload fingerprints, migration-safe request-fingerprint versioning, exact-money/date/occupancy bounds, tenant-safe integration and attempt ownership, provider-reference state rules, bounded provider/supplier confirmation reference formatting, confirmed-state provider-reference requirements, failed-state normalized evidence, and unique provider reservation references within tenant/integration.

Audits record only operational transition facts. Opaque property/offer references, provider/supplier locators, provider correlation values, offer/terms/payload fingerprints, traveler/customer data, card/payment material, credentials, tokens, and raw provider bodies are excluded from audit payloads and structured request logs.

## Validation

Dependency-free tests cover normalization, authority-bound request fingerprint v2, exact-idempotency conflicts, create-claim version gating, ambiguous-state behavior, provider metadata bounds, tenant/authorization ordering, reservation-capability gating, serializable claims, migration-safe legacy behavior, audit privacy, known-locator preservation, exact-locator matching for both `FOUND` and `NOT_FOUND`, supplier-confirmation persistence, coordinator provider-code checks, and normalized provider-failure settlement.

A guarded PostgreSQL scenario covers locator-less reconciliation denial, known-locator `FOUND`, durable supplier confirmation, transient `UNKNOWN` preservation and retry, authoritative `NOT_FOUND` clearing, mismatched `FOUND`/`NOT_FOUND` identity remaining ambiguous, and cross-tenant provider-I/O suppression. It is only executed through the disposable-database harness.

Live provider validation still requires a provisioned Travelport non-production account. Full Prisma migration/drift/database execution requires an explicitly disposable PostgreSQL target. Neither is claimed by source-only validation.

## Next dependency

The next reservation dependency remains the real create boundary, not a guessed POST. The SearchComplete-to-Availability bridge must be validated against Travelport non-production and SF must establish the PCI-safe form-of-payment/guarantee strategy for the provisioned account.

Only then should a single-room create adapter/execution coordinator be connected to this ledger. It must repeat fresh offer/Rules/Availability authority immediately before create, recompute request fingerprint v2, reconstruct only authorized traveler/payment/guarantee material, classify every provider write outcome, retain any known provider locator on ambiguity, and use the recovery coordinator only when that locator exists.

Locator-less ambiguity, explicit price/guarantee-change decisions, provider correlation semantics, cancellation, modification, and multi-room behavior remain separate live-validated capabilities rather than assumptions.
