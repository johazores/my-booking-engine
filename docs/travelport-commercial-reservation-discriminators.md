# Travelport commercial reservation discriminators

## Purpose

Travelport Create Reservation and Booking.com Sync responses can authorize irreversible commercial state in SF. Their reservation and offer objects therefore cannot be treated as generic objects merely because nested hotel fields happen to look plausible.

This boundary is implemented inside `classifyTravelportStaysReservationCreateOutcome`, which is shared by the initial/reviewed Create response path and `classifyTravelportStaysReservationSyncOutcome`.

## Authority rules

Before any returned hospitality product can prove the expected reservation, SF requires:

- `ReservationResponse.Reservation` to be an object with a bounded, single-line `@type` that normalizes to exactly `ReservationDetail`;
- every returned `Reservation.Offer` considered by the commercial classifier to be an object with a bounded, single-line `@type` that normalizes to exactly `Offer`;
- each offer to retain the existing bounded non-empty `Product` collection contract; and
- each product to retain the existing bounded typed product, property, stay, room, guest, receipt, and confirmation requirements.

Missing, non-string, blank, oversized, line-broken, or foreign reservation/offer discriminator evidence makes the hospitality match invalid. A normal Create response therefore cannot become `CONFIRMED` from that shape.

The same rule also applies to the documented supplier-confirmed/no-PNR path. Malformed reservation or offer discriminators cannot contribute the exact-stay evidence needed to retain the supplier confirmation or mint the opaque Booking.com Sync recovery reference.

Booking.com Sync delegates its returned reservation response to the same commercial classifier after only the narrow documented Travelport-locator-type normalization. Sync therefore inherits the same discriminator boundary and remains `AMBIGUOUS / INVALID_RESPONSE` when those response types are not canonical.

## Provider contract

Travelport's current Create Reservation reference-payload response example returns:

- `ReservationResponse.Reservation.@type = ReservationDetail`; and
- each returned hotel segment as `Offer.@type = Offer`.

Travelport's current Sync Reservation documentation says the Sync response uses the same structure as Create Reservation, and its example likewise returns `Reservation.@type = ReservationDetail` and `Offer.@type = Offer`.

SF deliberately does **not** add a commercial offer-ID requirement here. Travelport documents that the reference-payload Create response returns an offer `id`, while the full-payload response does not, and the current Sync example does not show an offer `id`. Offer-reference ownership remains a separate provider-contract concern and must not be inferred from undocumented identifiers.

## Scope and safety

This change is provider-specific and does not alter tenant authorization, persistence schemas, reservation capability advertisement, payment handling, retry semantics, or the known-locator Retrieve parser. It also does not make Travelport reservation capability production-ready by itself.

Travelport `reservation` remains disabled until the existing activation gates are satisfied: a reviewed PCI-safe FormOfPayment/guarantee authority, live non-production end-to-end verification, and authoritative live handling for `13034` and other locator-less negative/recovery semantics.

## Validation

Focused regression coverage verifies canonical Create success, malformed reservation discriminators, malformed offer discriminators, supplier-confirmed/no-PNR recovery authority, and Sync response classification. A dependency-free source contract also verifies that the discriminator checks occur before offer/product authority can be returned.

## References

- Travelport Create Reservation Reference Payload API Reference.
- Travelport Sync Reservation API Reference.
- `docs/travelport-stays-create-outcome-classification.md`.
- `docs/travelport-reservation-response-evidence.md`.
- `docs/travelport-known-locator-reservation-type.md`.