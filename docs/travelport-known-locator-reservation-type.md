# Travelport known-locator reservation type authority

## Purpose

Known-locator Travelport Stays recovery must validate the provider resource family before it trusts hotel segment, offer, receipt, or locator evidence. Travelport's current Hotel Retrieve examples return the inner reservation as `ReservationResponse.Reservation` with `@type=ReservationDetail`.

SF therefore requires the bounded canonical `ReservationDetail` discriminator whenever the Retrieve parser is given a durable reservation expectation. Missing, blank, non-string, oversized, line-broken, or different reservation type evidence fails closed to `INVALID_RESPONSE` before active/passive offer scope or receipt authority is evaluated.

This is a Retrieve recovery boundary only. It does not broaden Create Reservation or Booking.com Sync behavior, does not make a provider write reachable, and does not enable the Travelport `reservation` capability.

## Ordering

The known-locator parser now evaluates provider evidence in this order:

1. reject contradictory top-level `ErrorResponse` evidence;
2. validate bounded `ReservationResponse.Result` warning/error structure;
3. require `ReservationResponse.Reservation` to be an object;
4. require canonical `ReservationDetail` type evidence for durable known-locator recovery;
5. validate bounded unique `Offer` identifiers and offer discriminators;
6. identify exactly one active `ProductHospitality` segment matching the durable property, dates, room quantity, and guest count;
7. bind receipt `OfferRef` ownership to the returned offer namespace and active hotel offer; and
8. normalize only the bounded durable Travelport PNR, supplier confirmation, and correlation evidence already authorized by the preceding checks.

A structurally similar object from another Travelport reservation resource family therefore cannot become hotel recovery authority merely because it happens to contain fields named `Offer`, `ProductHospitality`, or `Receipt`.

## Compatibility

The low-level response parser still supports bounded historical response inspection when no durable reservation expectation is supplied. The strict `ReservationDetail` requirement is activated by the same `expectedReservation` input that turns on hotel identity and offer-scope verification in production known-locator recovery.

The production `TravelportStaysReservationRecoveryProvider` always supplies that durable expectation, so a successful `FOUND` result cannot bypass this discriminator requirement.

## Validation

Focused parser regression coverage includes the canonical `ReservationDetail` response and rejects missing, null, blank, wrong-family, line-broken, oversized, and non-string reservation type evidence before segment authority. Existing known-locator fixtures are aligned with the documented provider discriminator so their property, stay, offer, passive-segment, receipt, and locator assertions continue testing their intended boundary instead of failing earlier for stale fixture shape.

Dependency-free source contracts also lock both the discriminator check and its ordering ahead of `assertExpectedReservationMatch`.

Full Node 24 validation, Prisma/PostgreSQL execution, and live Travelport verification remain separate environment gates. GitHub Actions are not used.

## Provider reference

Travelport Retrieve Hotel Reservation API Reference:
https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
