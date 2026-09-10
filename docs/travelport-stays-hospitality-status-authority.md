# Travelport Stays hospitality status authority

## Purpose

Travelport reservation receipts are shared across multi-content bookings, so SF must preserve unrelated air receipt evidence without allowing malformed hotel evidence to disappear beside an otherwise valid Stays reservation.

The shared Stays receipt inspector treats both `Confirmation.OfferStatus.@type = OfferStatusHospitality` and `Cancellation.OfferStatus.@type = OfferStatusHospitality` as explicit hotel-reservation signals. Once that discriminator is present, the receipt must also present a supported Stays locator identity pair. It cannot be reclassified as unrelated multi-content evidence merely because `Locator.sourceContext` and/or `Locator.locatorType` are missing or belong to a foreign locator family.

## Authority rules

For confirmation receipts:

- canonical `OfferStatusHospitality` evidence with a supported Stays locator pair continues through the existing strict locator, status, source, `OfferRef`, receipt-type, and confirmation-type validation;
- `OfferStatusHospitality` with both `sourceContext` and `locatorType` omitted fails closed;
- `OfferStatusHospitality` with only part of the locator identity fails closed;
- `OfferStatusHospitality` paired with a non-Stays locator family fails closed;
- leading or trailing whitespace around the hospitality discriminator is malformed evidence rather than a way to hide the Stays signal; and
- unrelated multi-content status families such as `OfferStatusAir` remain outside Stays authority when they do not claim a Stays locator identity.

For shared-model `ReceiptCancellation` records:

- canonical Stays locator pairs continue through the existing strict cancellation type, locator, source, `OfferRef`, status-type, and `Status=Cancelled` validation;
- an explicit `Cancellation.OfferStatus.@type = OfferStatusHospitality` cannot stand alone without both `sourceContext` and `locatorType`;
- partial or foreign locator identity paired with the hospitality status discriminator fails closed;
- leading or trailing whitespace around the hospitality discriminator is malformed evidence and cannot make the cancellation look unrelated; and
- generic multi-content cancellation evidence such as `OfferStatusAir`, including the documented air `Travelport + Locator` shape, remains outside Stays authority when it does not claim a Stays locator family.

This is a validation boundary only. It does not create a new locator family, normalize a foreign receipt into a hotel receipt, or promote status evidence into provider-neutral reservation identity.

## Why this matters

Travelport's current Stays Create, Retrieve, and Cancel examples identify hotel receipt state with `OfferStatus.@type = OfferStatusHospitality` and pair that state with hotel locator semantics. The current Hotel Cancel response keeps the supplier cancellation in a `ReceiptConfirmation` with `sourceContext=Supplier`, `locatorType=Cancellation Number`, and `Status=Cancelled`. Travelport's shared Reservation Retrieve model also defines `ReceiptCancellation` with a `Cancellation` object, while unrelated air examples use distinct locator/status shapes such as `OfferStatusAir`.

SF therefore treats the hospitality status discriminator as a provider-specific claim that must remain inside the fail-closed Stays boundary. It is not enough, by itself, to establish which hotel locator family the evidence belongs to. A hospitality-typed cancellation with no Stays locator identity is malformed rather than valid cancellation authority.

Without this rule, a confirmation or cancellation receipt could claim `OfferStatusHospitality` while omitting or replacing its Stays locator identity, be skipped or misclassified as generic multi-content evidence, and allow sibling evidence to grant active reservation authority. The inspector now applies the same discriminator-to-identity rule to both branches.

## Scope

The shared inspector is consumed by initial Create, reviewed Create, Booking.com Sync classification, and known-locator Retrieve. The change therefore closes the same evidence-hiding pattern across those consumers without adding provider behavior to the normalized booking domain.

Travelport `reservation` remains deliberately unadvertised. This hardening does not satisfy the remaining activation gates: a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less recovery semantics are still required.

## Validation

Focused tests cover canonical Stays confirmation and cancellation status evidence, missing locator identity, partial/foreign locator identity, whitespace-confusable hospitality status tokens, and preservation of unrelated `OfferStatusAir` confirmation/cancellation evidence in multi-content responses. A dependency-free source contract pins the shared discriminator claim rule on both confirmation and cancellation branches before either can fall through to generic multi-content handling.

## References

- Travelport Stays APIs Guide
- Travelport Create Reservation Reference Payload API Reference
- Travelport Cancel Hotel Reservation API Reference
- Travelport Retrieve Hotel Reservation API Reference
- Travelport shared Reservation Retrieve response documentation
- `docs/travelport-stays-receipt-evidence.md`
- `docs/travelport-reservation-response-evidence.md`
