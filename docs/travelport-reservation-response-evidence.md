# Travelport reservation response evidence

## Purpose

SF now has one provider-specific, read-only parser for the durable evidence that can be trusted from Travelport Stays reservation responses. The parser is used by known-locator Hotel Retrieve today and is intentionally reusable by a future Create Reservation executor after the PCI/payment and live-provider gates are satisfied.

This is not a reservation-create capability. No Travelport reservation POST, browser route, staff action, customer action, or `reservation` capability is added by this boundary.

## Normalized evidence

`parseTravelportStaysReservationResponse` accepts an untrusted Travelport response body and returns only:

- the single Travelport aggregator locator used for later provider retrieval;
- at most one supplier confirmation reference for the current single-room contract;
- a bounded provider correlation/trace identifier when present and safe.

Traveler data, names, email/phone values, form-of-payment details, card data, payment payloads, comments, accounting remarks, provider offer bodies, and raw response payloads are deliberately discarded.

The parser requires exactly one unique Travelport aggregator locator. Multiple distinct Travelport locators or multiple supplier confirmation references fail closed as `INVALID_RESPONSE` for the current single-room boundary. Locator and correlation strings are bounded and must not contain line breaks.

## Retrieve versus future create semantics

Known-locator Hotel Retrieve supplies `expectedProviderReservationReference`, so the returned Travelport locator must exactly equal the locator used in the request. Retrieve does not require the current offer status to be `Confirmed`; finding a cancelled or otherwise historical provider record is still provider evidence that the locator exists and must never be interpreted as safe proof that an uncertain create did not occur.

A future Create Reservation executor must use the same parser with `requireConfirmedTravelportReceipt: true`. That mode requires exactly one Travelport receipt for the normalized locator and requires its `OfferStatus/Status` to be `Confirmed` before SF can settle the external write as confirmed. Any supplier receipt that is present must also report `Confirmed`; `Pending`, `Rejected`, `Cancelled`, missing, duplicated, or malformed provider confirmation state fails closed instead of being written as a successful reservation.

Travelport's public Create Reservation documentation states that the response `Receipt` objects carry the supplier and aggregator confirmations required for later retrieve/modify/cancel operations, and lists `Confirmed`, `Pending`, `Rejected`, and `Cancelled` as possible hospitality offer statuses. The response parser therefore treats confirmation status as part of create-success authority rather than assuming any HTTP 2xx body proves a booking.

## Remaining durability boundary

The current supplier reservation ledger persists the confirmed provider reservation reference and bounded provider correlation evidence, but it does not yet persist the supplier confirmation reference. Travelport documents the supplier confirmation as required for cancellation, so a future reservation-lifecycle slice must add that tenant-scoped durable field and settle it atomically with confirmation before cancellation can be claimed complete.

No schema field is added in this slice because the current repository has no reachable Travelport create or cancellation capability. Persistence should be introduced together with the real execution coordinator so the database constraint, settlement transaction, reconciliation behavior, and cancellation contract can be validated as one coherent commercial write boundary rather than leaving unused lifecycle state.

## Validation

Dependency-free TypeScript tests cover confirmed create evidence, known-locator retrieve matching, non-confirmed create rejection, ambiguous/multiple locator rejection, supplier-reference cardinality, unsafe provider strings, and privacy minimization. The existing recovery adapter now delegates response parsing to this shared boundary, eliminating a second independent interpretation of Travelport receipt authority.

Live Create Reservation response validation remains blocked on provisioned Travelport non-production credentials and the reviewed PCI-safe form-of-payment/guarantee strategy. No source-only test is claimed as live-provider evidence.

## References

- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
