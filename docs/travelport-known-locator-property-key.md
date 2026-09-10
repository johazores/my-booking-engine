# Travelport Stays property-key evidence

## Purpose

SF uses Travelport `PropertyKey.chainCode` and `PropertyKey.propertyCode` as part of reservation identity when interpreting commercial Create/Sync outcomes and when proving that a known-locator Retrieve response belongs to the durable reservation SF attempted to create. Matching text cannot be trusted if the provider payload explicitly identifies the containing object as another schema family.

This boundary strengthens provider-response interpretation only. It does not enable the Travelport `reservation` capability and does not add a customer or staff supplier-booking action.

## Provider contract

Travelport's current Hotel Retrieve example returns the active `ProductHospitality` segment with a `PropertyKey` object containing `@type: "PropertyKey"`, `chainCode`, and `propertyCode`.

Travelport response shapes are not completely uniform across Stays operations. The current Booking.com Sync response example returns `PropertyKey.chainCode` and `PropertyKey.propertyCode` without an `@type` discriminator. SF therefore does not manufacture a global presence requirement from one response example.

## SF authority rule

Where SF uses a Travelport `PropertyKey` to match the expected reservation:

- `PropertyKey` must be a structured object before its fields can be read;
- if `PropertyKey.@type` is present and non-null, it must be a bounded single-line value that normalizes to exactly `PropertyKey`;
- a blank, multiline, oversized, non-string, or foreign explicit discriminator cannot contribute positive reservation identity;
- an omitted or null discriminator remains compatible with provider shapes that do not emit it; and
- exact matching of chain, property, stay dates, room quantity, and guest count remains mandatory.

Known-locator Retrieve treats an explicit contradiction as `INVALID_RESPONSE` before chain/property identity can contribute `FOUND` authority. The commercial Create/Sync classifier applies the same optional-explicit rule before a response can be confirmed or before supplier-confirmed/no-PNR evidence can mint a Booking.com Sync recovery reference. A contradictory `PropertyKey` therefore cannot become confirmation or Sync authority even when the surrounding locator data looks valid.

The rule does not inspect or retain traveler, payment-card, form-of-payment, credential, or free-form provider data.

## Why this fails closed

A typed object that says it belongs to another content/schema family is contradictory evidence. Ignoring that discriminator while trusting its `chainCode` and `propertyCode` fields could allow malformed provider data to settle an unrelated ambiguous write or confirm the wrong commercial response.

At the same time, requiring an always-present discriminator would be stronger than the currently documented cross-operation provider shapes support. The implemented rule therefore rejects explicit contradiction without inventing authority from absence.

## Validation

Focused Retrieve coverage checks canonical acceptance, omission compatibility, and malformed/foreign discriminator rejection. Focused commercial-classifier coverage checks canonical and omitted acceptance, explicit contradiction rejection for a normal confirmed response, and denial of Sync recovery authority for a supplier-confirmed/no-PNR response with contradictory property typing. A dependency-free source contract locks both boundaries and verifies that type evidence is evaluated before chain/property identity fields are trusted.

Full repository validation still requires the repository-supported Node 24/TypeScript 6 environment. Live provider verification remains a separate activation gate. GitHub Actions are not used.

## Provider references

- Travelport Hotel v11 Retrieve Hotel Reservation: `Hotel11/APIReferences/APIRef_Retrieve.htm`
- Travelport Hotel v11 Sync Reservation: `Hotel11/APIReferences/APIRef_Sync.htm`
