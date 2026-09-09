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

Travelport Hotel Retrieve still requires the exact durable aggregator locator. In addition, the Travelport adapter decodes the existing SF property reference and requires the retrieved reservation to contain exactly one non-passive `ProductHospitality` segment, and that active segment must match the durable request across:

- Travelport property identity (`chainCode` and `propertyCode`);
- stay dates (`DateRange.start` and `DateRange.end`);
- room quantity (`Quantity`); and
- total guest count (`guests`, derived from adults plus child count).

Travelport's current Retrieve documentation explicitly shows a reservation containing one active offer and one placeholder passive offer. The active offer carries `passiveOfferInd=false`; the placeholder carries `passiveOfferInd=true` and may contain an intentionally incomplete `ProductHospitality` product. Known-locator recovery therefore excludes only an explicitly passive offer from active hotel identity cardinality. When `passiveOfferInd` is present and non-null it must be a boolean; malformed values fail closed. An absent or null passive indicator is not treated as proof that an offer is passive.

Non-hospitality content in a multi-content PNR does not count as Stays identity evidence. A second non-passive or unclassified `ProductHospitality` segment, including a mismatched or malformed one, remains contradictory evidence and fails closed; it is not ignored merely because another active hotel segment matches. Zero active hospitality segments, multiple active hospitality segments, or one active hospitality segment that does not exactly match the durable request are `INVALID_RESPONSE` and remain fail-closed through the existing `UNKNOWN -> AMBIGUOUS` reconciliation path.

This passive-placeholder allowance belongs only to known-locator Retrieve identity. Create Reservation and Booking.com Sync continue to use the independent commercial-write classifier and keep their stricter response cardinality rules; recovery parsing does not broaden external-write confirmation authority.

The adapter validates the durable expectation before requesting an OAuth token or sending Hotel Retrieve. Invalid SF/provider-reference input therefore cannot cause provider I/O.

## Supplier confirmation continuity

When SF already holds a normalized supplier confirmation for the ambiguous reservation, that confirmation is part of the durable reservation identity. A later `FOUND` recovery result must return the exact same supplier confirmation before the operation may become `CONFIRMED`.

The comparison happens server-side after the provider result has been normalized and before the `FOUND` success observation or settlement. The known supplier confirmation is not added to the outbound Retrieve request and is not copied into operational logs.

A missing or different recovered supplier confirmation cannot silently replace the durable value. SF records `SUPPLIER_CONFIRMATION_MISMATCH`, keeps the operation ambiguous, preserves the existing provider and supplier references, and does not authorize another Create. Provider-correlation and recovered supplier-confirmation fields are normalized before any `FOUND` settlement so malformed runtime adapter values also fail closed to `INVALID_RESPONSE` instead of leaving a successful-looking recovery result.

Negative recovery is stricter because a provider-neutral `NOT_FOUND` result asserts that the known locator does not identify the attempted reservation. That assertion is accepted as retry authority only when SF has no durable supplier confirmation **and** the runtime provider result itself carries no supplier-confirmation evidence. If a durable supplier confirmation exists, or a malformed/buggy adapter returns any non-null supplier-confirmation value alongside `NOT_FOUND`, the evidence is contradictory. SF records `SUPPLIER_CONFIRMATION_MISMATCH`, preserves the durable provider/supplier identity it already has, leaves the operation `AMBIGUOUS`, and does not authorize another Create. An empty string is also treated as contradictory presented evidence rather than being normalized away into negative authority.

The separate `SUPPLIER_CONFIRMATION_MISSING` recovery state remains valid: if SF never had a supplier confirmation, a matching `FOUND` result may complete that missing lifecycle authority. It is only an already-known supplier confirmation that is immutable during this create-recovery flow; a `NOT_FOUND` result can never be the vehicle for introducing supplier-confirmation evidence.

The provider-neutral confirmation-evidence rule is enforced twice: the coordinator checks it before emitting a successful provider observation, and the durable reconciliation settlement service checks it again before changing reservation state or clearing provider identity. The durable boundary reads raw runtime `NOT_FOUND` supplier-confirmation evidence before deciding whether negative recovery is authoritative, so a future direct JavaScript/server caller cannot bypass the rule simply because the TypeScript `NOT_FOUND` shape omits that field.

## Why money and offer identifiers are not matched here

The durable operation still retains exact accepted money, offer, Rules, payload, and selected-offer authority fingerprints. This recovery check deliberately does not reinterpret Travelport Retrieve pricing or booking-code fields as equivalent commercial authority without live provider validation. The purpose of this boundary is reservation identity, not a new pricing or modification contract.

A future create executor must still repeat fresh offer/Rules/Availability authority immediately before the write and must not accept provider price or guarantee changes silently.

## Failure and retry safety

A semantic mismatch never becomes provider-neutral `NOT_FOUND` and never makes another create retryable. The Travelport adapter, recovery coordinator, or durable reconciliation ledger records normalized invalid provider evidence, and the operation returns to `AMBIGUOUS` while preserving the known provider locator and any already-known supplier confirmation.

An authoritative provider-neutral `NOT_FOUND` can restore `PREPARED` only when the returned provider locator matches the durable locator, SF has no durable supplier confirmation, and the result itself contains no supplier-confirmation evidence. Generic Travelport HTTP 404 remains non-authoritative for negative lookup. Locator-less uncertainty also remains closed because the public Hotel Retrieve contract still requires an aggregator locator.

## Validation

Focused provider and parser tests cover exact matches plus property, chain, date, room, guest, active/passive-offer, duplicate/mismatched/malformed active hospitality-segment, locator, and malformed-input failures. The documented active-plus-passive Retrieve shape is accepted only when exactly one non-passive hotel segment matches the durable reservation; malformed `passiveOfferInd` evidence remains fail-closed. Supplier-confirmation recovery tests cover exact known-reference continuity, missing/different-reference rejection, contradictory negative lookup from durable identity or runtime result evidence, and the still-valid clean no-supplier-confirmation negative-recovery path. Dependency-free source contracts verify that recovery captures runtime supplier evidence before settlement, checks shared confirmation evidence before both `FOUND` and `NOT_FOUND` success observations, preserves the commercial Create classifier's stricter segment rule, and rechecks confirmation evidence at the durable ledger boundary.

Full Node 24 validation, Prisma/PostgreSQL execution, and live Travelport verification remain separate environment gates. GitHub Actions are not used.

## Provider reference

Travelport's current Retrieve Hotel Reservation documentation describes `GET book/reservations/{AggregatorLocatorCode}` and shows `ProductHospitality` responses containing `Quantity`, `guests`, `PropertyKey.chainCode`, `PropertyKey.propertyCode`, and `DateRange.start/end`. The same documentation includes a response with one active offer (`passiveOfferInd=false`) and one placeholder passive offer (`passiveOfferInd=true`). These provider fields are used only for the fail-closed identity comparison above.
