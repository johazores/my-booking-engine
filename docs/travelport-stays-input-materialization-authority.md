# Travelport Stays input materialization authority

## Purpose

Travelport supplier inputs are TypeScript `Readonly` values, but runtime callers can still provide mutable objects, getters, proxies, or arrays whose values change between reads. Provider adapter validation is therefore not an authority boundary unless the exact values being validated are the same values later used by the compatibility core and any asynchronous provider work.

This contract materializes caller-owned Travelport search-page, exact-property offer-search, offer-revalidation, Rules-review, and reservation-authority inputs before adapter validation or compatibility-core execution.

## Materialization contract

The public Travelport adapters copy only the declared provider-neutral input fields into new frozen objects. Child ages are copied into a new frozen array with the existing Travelport maximum of eight children. The source object and its child-age collection are read exactly once for each authoritative field during materialization.

The resulting snapshot is then used for canonical Travelport property/offer-reference validation and is the only object forwarded to the compatibility core. This means later SearchComplete, Rules, Availability, and final offer-revalidation work cannot observe a different caller-owned property reference, offer reference, stay, guest count, currency, expected total, offer fingerprint, or terms fingerprint after an asynchronous provider boundary.

Search pagination receives the same treatment so the page token validated by the public adapter is the page token consumed by the core request builder.

## Fail-closed behavior

Materialization happens before adapter validation. A throwing accessor, malformed child-age container, oversized child-age array, or revoked proxy becomes a fixed `INVALID_REQUEST` supplier error. Caller-controlled exception text is not propagated.

The materializer does not replace the existing semantic validators. Canonical reference validation, exact dates and currency, room/guest limits, exact money, fingerprints, and provider-specific request/response rules remain owned by the existing Travelport adapters and cores. The snapshot only guarantees that those validators and later provider work operate on stable authority.

## Similar-issue sweep

The same caller-reread pattern existed at three connected public boundaries:

- `TravelportStaysProvider` validated search-page/property/offer authority and then passed the original caller object to the core;
- `TravelportStaysBookingTermsProvider` validated references and then passed the original revalidation input into the Rules flow, whose core later reused it for final pricing revalidation; and
- `TravelportStaysReservationAuthorityProvider` validated references and then passed the original reservation-authority input into the Rules → SearchComplete → Availability chain.

All three now forward materialized snapshots. This closes the related TOCTOU surface for the current Travelport pricing/review/reservation-authority chain without changing provider capabilities or core-domain contracts.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This hardening does not provide the missing PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, or authoritative live `13034` / locator-less recovery semantics required by Phase 15.

Related documentation:

- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-commercial-authority.md`
