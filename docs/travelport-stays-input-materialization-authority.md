# Travelport Stays input materialization authority

## Purpose

Travelport supplier inputs are TypeScript `Readonly` values, but runtime callers can still provide mutable objects, getters, proxies, or arrays whose values change between reads. Provider adapter validation is therefore not an authority boundary unless the exact values being validated are the same values later used by the compatibility core and any asynchronous provider work.

This contract materializes caller-owned Travelport search-page, exact-property offer-search, offer-revalidation, Rules-review, and reservation-authority inputs before adapter validation or compatibility-core execution.

## Materialization contract

The public Travelport adapters copy only the declared provider-neutral input fields into new frozen objects. Child ages are copied into a new frozen array with the existing Travelport maximum of eight children. The source object and its child-age collection are read exactly once for each authoritative field during materialization.

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

## Activation boundary

Travelport `reservation` remains deliberately disabled. This hardening does not provide the missing PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, or authoritative live `13034` / locator-less recovery semantics required by Phase 15.

Related documentation:

- `docs/travelport-stays-entry-authority.md`
- `docs/travelport-stays-constructor-authority.md`
- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-commercial-authority.md`
