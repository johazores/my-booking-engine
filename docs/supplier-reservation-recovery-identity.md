# Supplier reservation recovery identity

## Purpose

Known-locator recovery must prove more than the existence of a provider locator before SF can treat an uncertain supplier write as the reservation it attempted to create. A provider locator is necessary recovery authority, but a mismatched or externally repurposed reservation must not be allowed to settle an unrelated durable operation as confirmed.

This boundary strengthens read-only recovery only. It does not enable or advertise Travelport `reservation`, create, modification, cancellation, or any customer/staff supplier-booking action.

## Provider-neutral expectation

`HospitalitySupplierReservationRecoveryRequest` carries a durable `expectedReservation` snapshot alongside the provider reservation locator and persisted attempt UUID. The coordinator builds that expectation only from the already-authorized tenant-owned reservation operation after the reconciliation claim succeeds.

The expectation contains only:

- the opaque supplier property reference;
- arrival and departure local dates;
- room quantity;
- adult count; and
- child ages used only to derive the expected total guest count inside the provider adapter.

No traveler identity, customer contact data, payment/card material, credentials, provider response body, or supplier locator is added to logs or audits by this contract.

## Travelport matching

Travelport Hotel Retrieve still requires the exact durable aggregator locator. In addition, the Travelport adapter decodes the existing SF property reference and requires the retrieved reservation to contain exactly one `ProductHospitality` segment, and that single segment must match the durable request across:

- Travelport property identity (`chainCode` and `propertyCode`);
- stay dates (`DateRange.start` and `DateRange.end`);
- room quantity (`Quantity`); and
- total guest count (`guests`, derived from adults plus child count).

Travelport can return non-hospitality content in a multi-content PNR, and those products do not count as Stays identity evidence. A second, mismatched, or malformed `ProductHospitality` segment is contradictory evidence and fails closed; it is not ignored merely because another hotel segment matches. Zero hospitality segments, multiple hospitality segments, or one hospitality segment that does not exactly match the durable request are `INVALID_RESPONSE` and remain fail-closed through the existing `UNKNOWN -> AMBIGUOUS` reconciliation path.

The adapter validates the durable expectation before requesting an OAuth token or sending Hotel Retrieve. Invalid SF/provider-reference input therefore cannot cause provider I/O.

## Supplier confirmation continuity

When SF already holds a normalized supplier confirmation for the ambiguous reservation, that confirmation is part of the durable reservation identity. A later `FOUND` recovery result must return the exact same supplier confirmation before the operation may become `CONFIRMED`.

The comparison happens server-side after the provider result has been normalized and before the `FOUND` settlement. The known supplier confirmation is not added to the outbound Retrieve request and is not copied into operational logs.

A missing or different recovered supplier confirmation cannot silently replace the durable value. SF records `SUPPLIER_CONFIRMATION_MISMATCH`, keeps the operation ambiguous, preserves the existing provider and supplier references, and does not authorize another Create. Provider-correlation and recovered supplier-confirmation fields are normalized before any `FOUND` or `NOT_FOUND` settlement so malformed runtime adapter values also fail closed to `INVALID_RESPONSE` instead of leaving a successful-looking recovery result.

The separate `SUPPLIER_CONFIRMATION_MISSING` recovery state remains valid: if SF never had a supplier confirmation, a matching recovered supplier confirmation may complete that missing lifecycle authority. It is only an already-known supplier confirmation that is immutable during this create-recovery flow.

## Why money and offer identifiers are not matched here

The durable operation still retains exact accepted money, offer, Rules, payload, and selected-offer authority fingerprints. This recovery check deliberately does not reinterpret Travelport Retrieve pricing or booking-code fields as equivalent commercial authority without live provider validation. The purpose of this boundary is reservation identity, not a new pricing or modification contract.

A future create executor must still repeat fresh offer/Rules/Availability authority immediately before the write and must not accept provider price or guarantee changes silently.

## Failure and retry safety

A semantic mismatch never becomes provider-neutral `NOT_FOUND` and never makes another create retryable. The Travelport adapter or recovery coordinator records normalized invalid provider evidence, and the ledger returns the operation to `AMBIGUOUS` while preserving the known provider locator and any already-known supplier confirmation.

Generic Travelport HTTP 404 remains non-authoritative for negative lookup. Locator-less uncertainty also remains closed because the public Hotel Retrieve contract still requires an aggregator locator.

## Validation

Focused provider and parser tests cover exact matches plus property, chain, date, room, guest, duplicate/mismatched/malformed hospitality-segment, locator, and malformed-input failures. Supplier-confirmation recovery tests cover exact known-reference continuity plus missing/different-reference rejection. Dependency-free source contracts verify that recovery normalizes provider evidence before settlement, checks a known durable supplier confirmation before the success observation and `FOUND` settlement, and never passes the raw recovered supplier confirmation directly into the durable success path.

Full Node 24 validation, Prisma/PostgreSQL execution, and live Travelport verification remain separate environment gates. GitHub Actions are not used.

## Provider reference

Travelport's current Retrieve Hotel Reservation documentation describes `GET book/reservations/{AggregatorLocatorCode}` and shows `ProductHospitality` responses containing `Quantity`, `guests`, `PropertyKey.chainCode`, `PropertyKey.propertyCode`, and `DateRange.start/end`. These are the provider fields used only for the fail-closed identity comparison above.
