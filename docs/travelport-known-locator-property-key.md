# Travelport known-locator property-key evidence

## Purpose

Known-locator Hotel Retrieve is recovery authority for a previously ambiguous external reservation write. SF therefore cannot treat matching `chainCode` and `propertyCode` text as sufficient hotel identity when the provider payload explicitly identifies the containing object as another schema family.

This boundary only strengthens read-only Travelport recovery. It does not enable the Travelport `reservation` capability and does not broaden Create Reservation or Booking.com Sync behavior.

## Provider contract

Travelport's current Hotel Retrieve example returns the active `ProductHospitality` segment with a `PropertyKey` object containing `@type: "PropertyKey"`, `chainCode`, and `propertyCode`. The same Retrieve contract is the provider source already used by SF for durable property/stay/room/guest recovery matching.

Travelport response shapes are not completely uniform across Stays operations. The current Booking.com Sync response example returns `PropertyKey.chainCode` and `PropertyKey.propertyCode` without an `@type` discriminator. SF therefore does not manufacture a new global requirement from one response example.

## SF authority rule

When durable `expectedReservation` evidence is supplied to the Retrieve parser:

- `PropertyKey` must still be a structured object before its fields can be read;
- if `PropertyKey.@type` is present and non-null, it must be a bounded single-line value that normalizes to exactly `PropertyKey`;
- a blank, multiline, oversized, non-string, or foreign explicit discriminator fails closed as `INVALID_RESPONSE` before `chainCode` or `propertyCode` can contribute positive recovery authority;
- an omitted or null discriminator remains compatible with provider shapes that do not emit it; and
- exact durable matching of chain, property, stay dates, room quantity, and guest count remains mandatory.

The rule is intentionally inside `assertExpectedReservationMatch`. Low-level reservation parsing without durable recovery expectations does not gain a new property-identity contract, and Create/Sync continue to use their separate commercial response classifier.

## Why this fails closed

A typed object that says it belongs to another content/schema family is contradictory evidence. Ignoring that discriminator while trusting its `chainCode` and `propertyCode` fields could allow malformed provider data to settle an unrelated ambiguous write as `FOUND`.

At the same time, requiring an always-present discriminator would be stronger than the currently documented cross-operation provider shapes support. The implemented rule therefore rejects explicit contradiction without inventing authority from absence.

## Validation

Focused TypeScript coverage checks canonical acceptance, omission compatibility, and malformed/foreign discriminator rejection. A dependency-free source contract locks the bounded discriminator rule and verifies that the discriminator is checked before chain/property identity fields are trusted.

Full repository validation still requires the repository-supported Node 24/TypeScript 6 environment. Live provider verification remains a separate activation gate. GitHub Actions are not used.

## Provider references

- Travelport Hotel v11 Retrieve Hotel Reservation: `Hotel11/APIReferences/APIRef_Retrieve.htm`
- Travelport Hotel v11 Sync Reservation: `Hotel11/APIReferences/APIRef_Sync.htm`
