# Travelport commercial receipt scope

## Purpose

Travelport Create Reservation and Booking.com Sync responses can move SF from provider uncertainty into durable booking authority. Supplier confirmation evidence therefore must not be allowed to drift across offers in a multi-content reservation, and the Travelport PNR must remain reservation-level evidence.

This rule is implemented inside the Travelport Stays commercial response classifier. It is provider-specific and does not change the normalized booking domain or tenant authorization boundary.

## Provider evidence

Travelport's current Stays reservation response model uses `OfferRef` on supplier confirmation receipts to identify the offer they belong to, while the Travelport PNR receipt is reservation-level and is returned without `OfferRef`. Current reference-payload Create examples return `Offer.id`, but the current Booking.com Sync response example scopes supplier evidence to `O1` while omitting `Offer.id` from its sole returned offer. The classifier therefore uses explicit ID equality whenever the provider supplies enough offer identity, while preserving the ownership-unambiguous single-offer response shape documented for Sync.

The documented reservation-level PNR shape omits `OfferRef`; it does not present `OfferRef: null`. Likewise, the documented single-offer Sync compatibility relies on `Offer.id` being absent, not explicitly null. SF treats actual field absence as provider omission evidence and does not reinterpret an explicitly present JSON `null` as equivalent omission.

## Commercial authority rule

For Create and Booking.com Sync response classification:

- every present offer ID must be a bounded single-line value; explicit `Offer.id: null`, malformed IDs, and duplicate present IDs fail closed;
- a Travelport `PNR Locator` receipt is reservation-level and any present `OfferRef`, including explicit `null`, fails closed;
- a Supplier `Confirmation Number` receipt with `OfferRef` must contain exactly one bounded reference, and explicit `null` fails closed rather than entering omission compatibility;
- when the matching hotel offer has an ID, a scoped supplier receipt must reference exactly that ID;
- when the matching hotel offer genuinely omits its ID, scoped supplier evidence is tolerated only when exactly one offer exists, matching Travelport's current single-offer Sync response shape;
- a genuinely omitted supplier `OfferRef` is likewise tolerated only when exactly one offer exists, because there is no competing offer ownership to confuse; and
- once multiple offers exist, supplier confirmation must be explicitly bound to the identified matching hotel offer before it can contribute commercial authority.

The shared Stays receipt inspector still owns locator-family, status, receipt-shape, cancellation, and cardinality validation. This layer only adds the offer-ownership proof that requires knowledge of the matched hotel offer.

## Failure behavior

Contradictory or ambiguous receipt ownership returns `INVALID_RESPONSE`. Explicit-null offer identity also returns `INVALID_RESPONSE`; it does not fall into the single-offer compatibility branch. These failures do not become retryable sell failures and cannot mint Booking.com Sync recovery authority. This is intentional because a commercial write may already have reached the supplier.

The documented supplier-confirmed/no-PNR warning can produce a Sync recovery reference only when the expected hotel segment matches and its supplier confirmation survives the same ownership checks.

## Compatibility boundary

Single-offer responses remain ownership-unambiguous when `Offer.id` or supplier `OfferRef` is genuinely omitted. This narrow compatibility is needed because Travelport's current Sync example returns one hotel offer without an `id` while its supplier receipt refers to `O1`. Explicit `Offer.id: null` and explicit `OfferRef: null` are not treated as omission. The compatibility does not apply once multiple offers exist, and it does not apply to Travelport PNR scope: the PNR remains reservation-level in every case.

The same absent-not-null rule is enforced by known-locator Retrieve for provider fields that establish active hotel identity and passive scope before receipt ownership can contribute provider reservation authority. This keeps Create, Sync, and recovery aligned on the meaning of provider field presence while preserving their intentionally different passive-segment semantics.

If SF later supports a materially different Travelport Create request/response mode, its receipt ownership semantics must be reviewed as a separate provider contract rather than weakening this one.

## Activation boundary

Travelport `reservation` remains disabled. This hardening does not satisfy the remaining production activation gates: a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / negative-lookup / locator-less recovery semantics.
