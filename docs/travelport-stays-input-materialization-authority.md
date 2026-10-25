# Travelport Stays input materialization authority

## Purpose

Travelport supplier inputs are TypeScript `Readonly` values, but runtime callers can still provide mutable objects, getters, proxies, or arrays whose values change between reads. Provider adapter validation is therefore not an authority boundary unless the exact values being validated are the same values later used by the compatibility core and any asynchronous provider work.

This contract materializes caller-owned Travelport city-search, search-page, exact-property offer-search, offer-revalidation, Rules-review, and reservation-authority inputs before adapter validation or compatibility-core execution.

## Materialization contract

The public Travelport adapters copy only the declared provider-neutral input fields into new frozen objects. City search now includes the IATA code and optional radius, alongside stay dates and occupancy. Child ages are copied into a new frozen array with the existing Travelport maximum of eight children. The source object and its child-age collection are read exactly once for each authoritative field during materialization.

The resulting snapshot is then used for canonical Travelport property/offer-reference validation and is the only object forwarded to the compatibility core. This means later SearchComplete, Rules, Availability, and final offer-revalidation work cannot observe a different caller-owned property reference, offer reference, stay, guest count, currency, expected total, offer fingerprint, or terms fingerprint after an asynchronous provider boundary.

Search pagination receives the same treatment so the page token validated by the public adapter is the page token consumed by the core request builder.

The connected pricing, Rules, and reservation-authority provider constructors apply the same principle to long-lived adapter authority. Credentials are copied into a frozen six-field snapshot, each top-level constructor field is read once, and the wrappers forward explicit materialized fields instead of spreading the original caller object. Cache-key validation and token-cache use therefore observe the same stable value.

Public configuration normalization, stored credential reads, direct access-token requests, and health probes now establish equivalent one-read snapshots before validation or provider I/O. See `docs/travelport-stays-entry-authority.md`.

## Fail-closed behavior

Materialization happens before adapter validation. A throwing accessor, malformed child-age container, oversized child-age array, or revoked proxy becomes a fixed `INVALID_REQUEST` supplier error. Caller-controlled exception text is not propagated.

Constructor and authentication-entry materialization follow the same rule: hostile accessors or revoked proxies cannot escape with caller-controlled errors, and later mutations of the original credential object cannot change the credential snapshot held by a provider or used for OAuth. Configuration entry failures use a fixed `TravelportStaysConfigurationError` instead of a supplier-operation error.

The materializers do not replace the existing semantic validators. Canonical reference validation, exact dates and currency, room/guest limits, exact money, fingerprints, cache-key validation, timeout validation, and provider-specific request/response rules remain owned by the existing Travelport adapters and cores. The snapshots only guarantee that those validators and later provider work operate on stable authority.

## Similar-issue sweep

The same caller-reread pattern existed at the connected public request boundaries and provider entry surfaces:

- `TravelportStaysProvider` request methods validated search-page/property/offer authority and then passed caller-owned request objects to the core;
- `TravelportStaysBookingTermsProvider` and `TravelportStaysReservationAuthorityProvider` previously forwarded caller-owned request/constructor state into their compatibility cores;
- the public pricing-provider constructor still spread caller-owned constructor state after those two wrappers were hardened; and
- configuration normalization, stored credential reads, direct access-token requests, and health probes could validate or copy one value and later reread the caller-owned object.

All of these connected read/authentication paths now operate on frozen allowlisted snapshots before semantic validation or provider work. The separate commercial write/recovery executors keep their existing reviewed pre-write materialization and ambiguity contracts.

## Compatibility-core child-age guard

The three Travelport compatibility cores (SearchComplete, Rules, and Availability) can also be invoked directly by internal code. Their occupancy normalizers reuse the same bounded, iterator-independent, fail-closed child-age snapshot as the public adapters. Each direct core now also materializes its full declared caller input before validation or asynchronous work. SearchComplete covers city search, pagination, exact-property pricing, and revalidation; Rules and Availability carry the same frozen offer, traveler occupancy, and commercial fingerprints into downstream providers and post-request comparisons. This prevents direct-core calls from spreading arbitrary caller-owned iterables, reading oversized arrays before checking the eight-child limit, or leaking exceptions from hostile element getters. Omitted child ages still mean zero children; valid ages retain existing semantic checks.

Focused regression tests cover frozen snapshots, poisoned iterators, oversized/non-array inputs, throwing element getters, and rejection by all three cores before provider I/O. Additional direct-core tests use single-read getters that throw on a second access and stop at a fake network/Rules handoff; these pin consistent scalar authority without requiring live credentials. The SearchComplete public adapter now snapshots city-search inputs before calling the core, closing the previously inherited unmaterialized search entry. This is defense in depth and does not expand any Travelport advertised capability.

## Source-contract regression maintenance

The Travelport Rules member and integration source-contract tests were brought into alignment with the current composed Unicode → reference → member → selection authority chain and the actual advertised read capabilities (`availability`, `hotel-search`, `pricing`). They no longer assert obsolete pre-composition wiring or an outdated hotel-search-only UI description. This is test maintenance, not a capability activation.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This hardening does not provide the missing PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, or authoritative live `13034` / locator-less recovery semantics required by Phase 15.

Related documentation:

- `docs/travelport-stays-entry-authority.md`
- `docs/travelport-stays-constructor-authority.md`
- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-commercial-authority.md`
