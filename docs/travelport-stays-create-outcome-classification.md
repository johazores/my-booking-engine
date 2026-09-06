# Travelport Stays create-outcome classification

## Purpose

A supplier reservation POST is a commercial write. Once SF crosses that provider boundary, an HTTP or payload failure is not automatically evidence that no hotel was sold. The Travelport create-outcome classifier therefore converts only documented provider evidence into safe decisions and otherwise fails closed to an ambiguous reservation outcome.

This module does not send Create Reservation, collect card data, enable the `reservation` capability, or expose a booking action. It is the provider-specific post-write decision boundary required by the future create coordinator.

## Documented decisions

Travelport Stays source codes `13016`, `13017`, and `13018` mean the guarantee requirement changed during sell. Source code `13020` means the price changed during sell. Travelport documents that these cases pause booking and require a second reservation request only if the customer explicitly accepts the new guarantee or price. SF classifies these responses as `REVIEW_REQUIRED`, including a combined price-and-guarantee review when both documented change codes are returned; it never sends `acceptGuaranteeChangeInd` or `acceptPriceChangeInd` automatically and never treats the original reviewed authority as still valid.

Source code `13034` is materially different. Travelport documents the same error for both a timeout where Booking.com did not sell and a timeout where Booking.com did sell. The response alone therefore cannot establish retry safety. SF classifies `13034` as `AMBIGUOUS / TRAVELPORT_SYNC_REQUIRED`, with no supplier confirmation invented from the error response.

Travelport also documents a third Booking.com failure mode in which the supplier sell succeeded but Travelport failed to finish PNR processing. In that case the reservation response can contain the confirmed supplier receipt but no Travelport PNR locator, together with the instruction to use Sync. SF preserves that bounded supplier confirmation only when the returned hospitality segment exactly matches the durable property, stay, room count, and guest count. It still remains `AMBIGUOUS` until Travelport Sync constructs the PNR and returns a verified Travelport locator.

Any unrecognized, malformed, or otherwise unprovable result after a commercial POST is `AMBIGUOUS / INVALID_RESPONSE`. A future coordinator must not turn an unknown 4xx/5xx or malformed 2xx into a blind create retry.

## Structural response authority

Provider response structure is part of the proof required to call a commercial write successful. The classifier distinguishes the absence of an `ErrorResponse` from a malformed error envelope. Once an error envelope is present, it cannot be treated as a successful sell: only a complete set of documented price/guarantee change codes can become `REVIEW_REQUIRED`, while unknown, mixed, malformed, or oversized error evidence remains `AMBIGUOUS / INVALID_RESPONSE`. Source code `13034` remains the stronger fail-closed Sync signal even when the surrounding error response is imperfect.

Reservation warning evidence is also bounded. Malformed or oversized warning collections, conflicting `Warning`/`Warnings` shapes, and warning records without a bounded message cannot be silently ignored before confirmation. Bounded non-Sync warnings do not erase otherwise complete confirmation evidence, but malformed warning structure prevents a response from being promoted to `CONFIRMED`.

The durable reservation expectation is validated before it can match provider data. The current create classifier only recognizes the supported single-room, one-to-nine-guest contract with canonical local dates and bounded Travelport chain/property identifiers. Invalid expected authority therefore cannot accidentally match a malformed provider payload and create false confirmation evidence.

## Privacy and evidence

The classifier returns only normalized decision state, bounded locator/correlation evidence, and fixed SF failure/review codes. It does not return or log provider error messages, traveler data, form-of-payment data, PAN/CVV, credentials, request bodies, or response bodies.

Supplier confirmation evidence by itself never means that the Travelport reservation is fully confirmed. The provider PNR locator remains required for the normal Retrieve/Modify/Cancel lifecycle. Sync is a separate provider operation and must be connected with durable write idempotency/recovery plus the authorized traveler email and Booking.com confirmation evidence required by Travelport.

## References

- Travelport Stays API Error Messaging: source codes 13016-13018 (guarantee changes), 13020 (price change), and 13034 (supplier confirmation uncertainty).
- Travelport TripServices Stays APIs Guide: price/guarantee changes at booking and the three documented aggregator sell-failure cases.
- Travelport Sync Reservation API Reference: `POST book/reservations/` creates the Travelport aggregator segment without re-selling the Booking.com reservation and requires the Booking.com confirmation plus traveler details.

## Remaining boundary

The Travelport reservation capability stays disabled. The next create dependency is still a reviewed PCI-safe form-of-payment strategy and an actual single-room create executor. When that executor exists, it must consume this classifier after provider I/O, preserve any sync evidence on ambiguity, require explicit fresh customer/staff review for price/guarantee changes, and never retry an unclassified write outcome as if it were known not to have sold.
