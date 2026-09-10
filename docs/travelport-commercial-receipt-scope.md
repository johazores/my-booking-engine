# Travelport commercial receipt scope

## Purpose

Travelport Create Reservation and Booking.com Sync responses can move SF from provider uncertainty into durable booking authority. Supplier confirmation evidence therefore must not be allowed to drift across offers in a multi-content reservation, and the Travelport PNR must remain reservation-level evidence.

This rule is implemented inside the Travelport Stays commercial response classifier. It is provider-specific and does not change the normalized booking domain or tenant authorization boundary.

## Provider evidence

Travelport's current Stays reservation response model identifies returned offers with `Offer.id`. Supplier and agency receipts use `OfferRef` to identify the offer they belong to, while the Travelport PNR receipt is reservation-level and is returned without `OfferRef`. The current Booking.com Sync response uses the Create Reservation response structure, so the same ownership rule applies to Sync recovery.

SF's implemented Create path sends the reference-payload `ReservationBuildFromCatalogOffering` request. Current reference-payload responses provide offer IDs. Full-payload response behavior is not used as an excuse to accept contradictory scoped evidence in the implemented path.

## Commercial authority rule

For Create and Booking.com Sync response classification:

- every present offer ID must be a bounded single-line value and duplicate present IDs fail closed;
- a Travelport `PNR Locator` receipt is reservation-level and any `OfferRef` on that PNR fails closed;
- a Supplier `Confirmation Number` receipt with `OfferRef` must contain exactly one bounded reference and it must equal the offer ID of the one matching hospitality segment;
- a scoped supplier receipt cannot be trusted when the matching hotel offer has no usable ID;
- an unscoped supplier confirmation is tolerated only when exactly one offer exists, because there is no competing offer ownership to confuse; and
- once multiple offers exist, unscoped supplier confirmation cannot contribute hotel commercial authority.

The shared Stays receipt inspector still owns locator-family, status, receipt-shape, cancellation, and cardinality validation. This layer only adds the offer-ownership proof that requires knowledge of the matched hotel offer.

## Failure behavior

Contradictory or ambiguous receipt ownership returns `INVALID_RESPONSE`. It does not become a retryable sell failure and cannot mint Booking.com Sync recovery authority. This is intentional because a commercial write may already have reached the supplier.

The documented supplier-confirmed/no-PNR warning can produce a Sync recovery reference only when the expected hotel segment matches and its supplier confirmation survives the same ownership checks.

## Compatibility boundary

The single-offer unscoped supplier case remains accepted for provider/backward compatibility because the reservation has no competing offer to which the confirmation could belong. This compatibility does not apply to Travelport PNR scope: the PNR remains reservation-level in every case.

If SF later supports a materially different Travelport Create request/response mode, its receipt ownership semantics must be reviewed as a separate provider contract rather than weakening this one.

## Activation boundary

Travelport `reservation` remains disabled. This hardening does not satisfy the remaining production activation gates: a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / negative-lookup / locator-less recovery semantics.
