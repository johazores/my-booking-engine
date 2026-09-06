# Supplier reservation recovery identity

## Purpose

Known-locator recovery must prove more than the existence of a provider locator before SF can treat an uncertain supplier write as the reservation it attempted to create. A provider locator is necessary recovery authority, but a mismatched or externally repurposed reservation must not be allowed to settle an unrelated durable operation as confirmed.

This boundary strengthens read-only recovery only. It does not enable or advertise Travelport `reservation`, create, modification, cancellation, or any customer/staff supplier-booking action.

## Provider-neutral expectation

`HospitalitySupplierReservationRecoveryRequest` now carries a durable `expectedReservation` snapshot alongside the provider reservation locator and persisted attempt UUID. The coordinator builds that expectation only from the already-authorized tenant-owned reservation operation after the reconciliation claim succeeds.

The expectation contains only:

- the opaque supplier property reference;
- arrival and departure local dates;
- room quantity;
- adult count; and
- child ages used only to derive the expected total guest count inside the provider adapter.

No traveler identity, customer contact data, payment/card material, credentials, provider response body, or supplier locator is added to logs or audits by this contract.

## Travelport matching

Travelport Hotel Retrieve still requires the exact durable aggregator locator. In addition, the Travelport adapter decodes the existing SF property reference and requires the retrieved reservation to contain exactly one `ProductHospitality` segment matching the durable request across:

- Travelport property identity (`chainCode` and `propertyCode`);
- stay dates (`DateRange.start` and `DateRange.end`);
- room quantity (`Quantity`); and
- total guest count (`guests`, derived from adults plus child count).

The response may contain other non-matching segments, including later provider-side additions, but exactly one hospitality segment must match the operation SF is recovering. Zero matches or multiple matches are `INVALID_RESPONSE` and remain fail-closed through the existing `UNKNOWN -> AMBIGUOUS` reconciliation path.

The adapter validates the durable expectation before requesting an OAuth token or sending Hotel Retrieve. Invalid SF/provider-reference input therefore cannot cause provider I/O.

## Why money and offer identifiers are not matched here

The durable operation still retains exact accepted money, offer, Rules, payload, and selected-offer authority fingerprints. This recovery check deliberately does not reinterpret Travelport Retrieve pricing or booking-code fields as equivalent commercial authority without live provider validation. The purpose of this boundary is reservation identity, not a new pricing or modification contract.

A future create executor must still repeat fresh offer/Rules/Availability authority immediately before the write and must not accept provider price or guarantee changes silently.

## Failure and retry safety

A semantic mismatch never becomes provider-neutral `NOT_FOUND` and never makes another create retryable. The Travelport adapter returns an `INVALID_RESPONSE` failure, the coordinator records normalized provider-request failure evidence, and the ledger returns the operation to `AMBIGUOUS` while preserving the known provider locator.

Generic Travelport HTTP 404 remains non-authoritative for negative lookup. Locator-less uncertainty also remains closed because the public Hotel Retrieve contract still requires an aggregator locator.

## Validation

Focused provider and parser tests cover exact matches plus property, chain, date, room, guest, duplicate-match, locator, and malformed-input failures. The dependency-free source contract verifies the coordinator supplies the durable expectation, the Travelport adapter validates it before provider I/O, and the response parser requires exactly one matching hospitality segment.

Full Node 24 validation, Prisma/PostgreSQL execution, and live Travelport verification remain separate environment gates. GitHub Actions are not used.

## Provider reference

Travelport's current Retrieve Hotel Reservation documentation describes `GET book/reservations/{AggregatorLocatorCode}` and shows `ProductHospitality` responses containing `Quantity`, `guests`, `PropertyKey.chainCode`, `PropertyKey.propertyCode`, and `DateRange.start/end`. These are the provider fields used only for the fail-closed identity comparison above.
