# Travelport Stays Rules selection authority

## Purpose

The Travelport full-payload Rules call is a read-only commercial authority step between SearchComplete pricing and reservation review. SF already validates Rules structure, commercial scalars, penalties, collection members, and final offer revalidation. This contract additionally binds a successful Rules response to the exact supplier source and selected product represented by the outbound Rules request before the compatibility core can normalize that response.

This hardening does not advertise Travelport `reservation`, create a booking action, collect payment-card data, or relax the existing activation gates.

## Provider contract

Travelport's current Stays documentation describes Rules as retrieving the rules for a specific rate. For the full-payload request, `HotelAggregator` identifies the rate source derived from Availability authority, while `numberOfGuests` must be 1 through 9. The common Rules response includes `OfferHospitalityResponse.Identifier`, where `authority` identifies the rate source as `TVPT` or `BKNG`. Rules products include the booking code, property key, stay dates, and may include the number of guests.

SF therefore snapshots the outbound full-payload Rules selection before transport:

- only the fixed Travelport v11 Rules full-payload HTTPS endpoint and POST method can create this authority;
- `HotelAggregator=Travelport` binds the expected response source to `TVPT`;
- `HotelAggregator=Booking` binds the expected response source to `BKNG`;
- booking code, property chain/code, check-in/check-out dates, and guest count are captured from the exact serialized request body;
- malformed or unsupported request authority fails before provider transport.

For a successful Rules response:

- a present response `Identifier` must be an object whose `authority` exactly matches the selected source;
- the response must contain exactly one offer for this compatibility boundary;
- exactly one product must match the outbound booking code, property key, and stay dates; duplicate exact matches are ambiguous and fail closed; and
- when the matching product returns `guests`, it must be a safe integer equal to the outbound guest count.

The current compatibility boundary deliberately does not make `OfferHospitalityResponse.Identifier` mandatory yet. Existing checked-in Rules fixtures predate that requirement, and live non-production evidence has not yet established that every provisioned full-payload response returns it. A missing response `Identifier` remains compatible at this layer; a present contradictory or malformed identifier fails closed. This distinction avoids claiming stronger provider behavior than SF has verified.

## Similar-issue sweep

The surrounding Rules path was reviewed for selection ambiguity. Existing code already requires the selected product booking code and exact dates after matching the property, requires exact total/currency authority, and finishes with a no-cache SearchComplete offer revalidation. The remaining high-confidence gap was that a duplicate exact product could be accepted by the compatibility core's first-match behavior, and a present top-level supplier source could contradict the selected rate authority without being checked.

This authority wrapper closes both cases before normalization. It remains provider-specific and does not move Travelport response models into the core booking domain.

## Validation

Focused dependency-free behavior coverage verifies Travelport and Booking source matches, contradictory and malformed present source identifiers, duplicate selected products, stay mismatch, present guest-count mismatch, compatibility for omitted optional response source/guest evidence, request rejection before transport, and non-Rules traffic passthrough.

A dependency-free source contract pins wrapper composition, fixed Rules endpoint authority, Travelport/Booking source mapping, response source equality, exact selected-product cardinality, guest-count binding, and the absence of reservation/card-write behavior from this module.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised until the existing gates are complete:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-integration.md`
- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-stays-commercial-member-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
