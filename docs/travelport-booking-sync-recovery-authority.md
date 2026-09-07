# Travelport Booking.com Sync recovery authority

## Purpose

Travelport documents a Booking.com failure mode where the supplier sell succeeds but Travelport does not finish PNR processing. Retrying Create Reservation in that state can duplicate the hotel sell. SF therefore needs durable evidence that is sufficient to authorize a later provider-specific Sync attempt without treating the reservation as confirmed.

This boundary only records recovery authority. It does not call Sync, advertise the `reservation` capability, expose a route or button, or make an ambiguous reservation retryable.

## Provider evidence required

SF records Booking.com Sync recovery authority only from the documented supplier-confirmed/no-PNR warning response and only when all of the following are true:

- the returned hospitality product exactly matches the durable Travelport property, stay dates, single-room quantity, and guest count;
- there is exactly one confirmed supplier `Confirmation Number`;
- there is no confirmed Travelport/aggregator locator in the same response;
- the supplier locator source is exactly `BO`, which Travelport documents as Booking.com; and
- the matching offer has one bounded `Identifier.authority`, the value Travelport requires the Sync request to carry from the Availability offer.

The separate `13034` timeout error remains ambiguous but does **not** create this recovery authority. Travelport documents that `13034` can mean either no Booking.com sell or a completed Booking.com sell, and the error response alone does not provide enough proof to construct a safe Sync request.

## Durable representation

The Travelport adapter converts only the non-secret offer authority and verified Booking.com supplier source into a versioned opaque value such as `travelport-stays-sync-v1:BKNG:BO`. The provider-neutral ledger stores it as `providerRecoveryReference`; core booking logic does not parse Travelport fields.

The supplier confirmation remains in the existing `supplierConfirmationReference`. The recovery reference is bounded to 1024 characters, single-line, tenant-scoped, and database-constrained to exist only while the operation is `SUBMITTING` or `AMBIGUOUS`, with a supplier confirmation present.

No traveler name/email/telephone, PAN, CVV, cardholder data, payment data, credentials, token, provider request body, or response body is stored in this recovery reference or audit metadata.

## Crash-safe staging

The create coordinator stages the supplier confirmation and provider recovery reference only after the durable provider-request marker has been written and before final create settlement. The staging transaction requires `booking:manage`, organization/resource scope, the current `CREATE` attempt, and a non-null provider-request marker.

This ordering matters. If the process crashes after recovery evidence is staged but before final settlement, stale-attempt recovery can move the operation from `SUBMITTING` to `AMBIGUOUS` without losing the evidence required for a future Sync path. The operation still cannot re-enter Create Reservation.

If staging fails or evidence is incomplete, SF does not invent or partially reconstruct Sync authority. The write remains fail-closed and ambiguous.

## Remaining Sync execution work

A future Travelport Sync executor/coordinator must independently:

1. require `booking:manage` and exact tenant ownership;
2. accept only an `AMBIGUOUS`, locator-less operation with verified supplier confirmation and a valid Travelport Sync recovery reference;
3. re-bind the caller-supplied traveler to the existing reservation-payload fingerprint before using traveler contact fields;
4. use the fixed Travelport `POST book/reservations/` endpoint with `passiveOfferInd=true`, the retained offer authority, Booking.com supplier source, supplier confirmation, and authorized traveler data;
5. create its own durable external-write attempt and provider-request marker so an uncertain Sync response cannot be blindly repeated;
6. verify the Sync response against the durable property/stay/occupancy expectation, original supplier confirmation, and exactly one Travelport locator before moving the operation to `CONFIRMED`; and
7. remain disabled until live Travelport non-production behavior confirms the exact request/response and ambiguity semantics.

Travelport states that Sync builds the Travelport aggregator segment without re-selling the Booking.com reservation. SF will still treat Sync as an external write requiring its own crash-safe idempotency and recovery boundary.

## References

- Travelport Sync Reservation API Reference: `POST book/reservations/`; `passiveOfferInd=true`; offer identifier authority from Availability; traveler details; supplier confirmation locator; Booking.com supplier source `BO`.
- Travelport TripServices Stays APIs Guide: Booking.com aggregator sell failure and Sync handling.
