# Travelport Stays hospitality status authority

## Purpose

Travelport reservation receipts are shared across multi-content bookings, so SF must preserve unrelated air receipt evidence without allowing malformed hotel evidence to disappear beside an otherwise valid Stays reservation.

The shared Stays receipt inspector now treats `Confirmation.OfferStatus.@type = OfferStatusHospitality` as an explicit hotel-reservation signal. Once that discriminator is present, the receipt must also present a supported Stays locator identity pair. It cannot be reclassified as unrelated multi-content evidence merely because `Locator.sourceContext` and/or `Locator.locatorType` are missing or belong to a foreign locator family.

## Authority rules

For confirmation receipts:

- canonical `OfferStatusHospitality` evidence with a supported Stays locator pair continues through the existing strict locator, status, source, `OfferRef`, receipt-type, and confirmation-type validation;
- `OfferStatusHospitality` with both `sourceContext` and `locatorType` omitted fails closed;
- `OfferStatusHospitality` with only part of the locator identity fails closed;
- `OfferStatusHospitality` paired with a non-Stays locator family fails closed;
- leading or trailing whitespace around the hospitality discriminator is malformed evidence rather than a way to hide the Stays signal; and
- unrelated multi-content status families such as `OfferStatusAir` remain outside Stays authority when they do not claim a Stays locator identity.

This is a validation boundary only. It does not create a new locator family, normalize a foreign receipt into a hotel receipt, or promote status evidence into provider-neutral reservation identity.

## Why this matters

Travelport's current Stays Create and Retrieve examples identify sold hotel receipt state with `OfferStatus.@type = OfferStatusHospitality` and pair that state with hotel locator semantics such as `sourceContext=Supplier` plus `locatorType=Confirmation Number`, or `sourceContext=Travelport` plus `locatorType=PNR Locator`. Travelport's shared air reservation examples use a distinct `OfferStatusAir` shape. SF therefore has a provider-specific discriminator that can safely identify malformed Stays status evidence without rejecting unrelated air receipt status.

Without this rule, a receipt could claim `OfferStatusHospitality` while omitting or replacing its Stays locator identity, be skipped as generic multi-content evidence, and allow a sibling valid PNR receipt to grant active reservation authority. The inspector now keeps that malformed evidence inside the fail-closed Stays boundary.

## Scope

The shared inspector is consumed by initial Create, reviewed Create, Booking.com Sync classification, and known-locator Retrieve. The change therefore closes the same evidence-hiding pattern across those consumers without adding provider behavior to the normalized booking domain.

Travelport `reservation` remains deliberately unadvertised. This hardening does not satisfy the remaining activation gates: a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less recovery semantics are still required.

## Validation

Focused dependency-free tests cover canonical Stays status evidence, missing locator identity, partial/foreign locator identity, whitespace-confusable hospitality status tokens, and preservation of unrelated `OfferStatusAir` evidence in a multi-content response. A source contract pins the fail-closed check before the generic multi-content skip path.

## References

- Travelport Stays APIs Guide
- Travelport Create Reservation Reference Payload API Reference
- Travelport Retrieve Hotel Reservation API Reference
- Travelport shared Air Reservation Retrieve / Workbench response documentation
- `docs/travelport-stays-receipt-evidence.md`
- `docs/travelport-reservation-response-evidence.md`
