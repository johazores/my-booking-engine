# Travelport reservation null machine authority

## Purpose

Travelport Create Reservation, reviewed Create, Booking.com Sync, and known-locator Retrieve can return machine evidence that influences irreversible booking state or recovery decisions. At this provider boundary, explicit JSON `null` is not equivalent to omission. A field that is optional by omission cannot gain a second undocumented meaning merely because the provider returned the property with a null value.

This rule is fail closed and provider-specific. It does not enable Travelport `reservation`, add a product route, or create new retry/recovery authority.

## Shared response boundary

`travelport-stays-reservation-response-authority.ts` runs after the v11 response trace, HTTP family, media-type, and JSON checks and before Create, Sync, or recovery compatibility parsing. The shared guard now distinguishes genuine omission from explicit null consistently across the reservation machine-evidence tree.

The rule covers the directly traversed evidence used by the current reservation flows, including:

- `ReservationResponse.Result` and its error/warning collections;
- `ReservationResponse.Reservation`;
- reservation `Offer`, product, and `Receipt` collections;
- optional machine strings such as reservation/offer/product types and IDs, provider identifiers, property keys, dates, locator values/sources, and offer status values;
- receipt `Confirmation` / `Cancellation` branches;
- nested `Locator` and `OfferStatus` objects; and
- offer-reference collections.

For these fields, `undefined` still represents genuine omission where the compatibility contract allows omission. A present `null` value is malformed provider evidence and fails as `INVALID_RESPONSE` before it can be trimmed, ignored, converted into an empty collection, or interpreted by a downstream commercial classifier.

## Why this matters

The response boundary previously had several helpers that treated `undefined` and `null` identically. Downstream Create and known-locator parsers already rejected many of those shapes, but the shared authority layer could still allow null-valued machine evidence to cross into those parsers. That made the provider boundary less strict than the documented envelope rule and created multiple places where a future classifier refactor would need to remember the same absent-versus-null distinction.

The shared guard now owns that distinction. This keeps one fail-closed rule in front of all current reservation consumers and prevents a later parser from accidentally granting authority to a null-valued discriminator, identifier, locator, collection, or lifecycle field.

The rule does not make every omitted field commercially sufficient. Omission may pass this structural machine boundary while a later Create, Sync, or Retrieve classifier still requires the field for the specific outcome being proven. Structural validity and commercial sufficiency remain separate checks.

## Similar-issue sweep

The change is applied to the common helpers rather than one individual field. The sweep covers the same underlying null-as-omission pattern in bounded arrays, exact machine strings, provider text, local dates, source codes, categories, Result, Reservation, receipt branches, Locator, and OfferStatus evidence. Existing object-shape checks for `Identifier`, `PropertyKey`, and `DateRange` already rejected explicit null and remain unchanged.

This also preserves the documented passive-placeholder rule: a missing `Confirmation.Locator` may be meaningful for the narrowly supported passive placeholder, while `Locator: null` is malformed and cannot stand in for that omission.

## Validation

Focused executable coverage mutates a canonical reservation response across top-level result/reservation fields, collections, discriminators, identifiers, property/stay evidence, receipt branches, locator evidence, and offer status. Every explicit-null mutation must fail with provider `INVALID_RESPONSE`. Separate coverage deletes optional fields to verify that genuine omission remains representable where the structural boundary permits it.

A dependency-free source contract pins the shared helper semantics so a future refactor cannot silently restore `undefined || null` as the generic optional-evidence rule.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live behavior still requires provisioned Travelport non-production credentials and the remaining Phase 15 commercial activation gates.

## Activation boundary

This hardening does not enable Travelport `reservation`. Activation still requires:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned Travelport account;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live `13034` / locator-less correlation and retry semantics.

Related contracts:

- `docs/travelport-reservation-envelope-null-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-reservation-response-family-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
