# Travelport known-locator machine-token authority

## Purpose

Known-locator Hotel Retrieve is provider-truth recovery for a durable supplier reservation attempt. A successful response can settle uncertain commercial state, so Travelport-owned machine identifiers and discriminators must be treated as exact evidence rather than user-facing text.

This boundary applies to `parseTravelportStaysReservationResponse` when the durable reservation expectation is supplied. It does not enable the Travelport `reservation` capability and does not broaden Create Reservation or Booking.com Sync behavior.

## Exact-token rule

The Retrieve parser now requires provider machine strings to already be canonical. The common token guard rejects:

- leading or trailing whitespace;
- empty strings;
- oversized values; and
- ASCII control characters from `U+0000` through `U+001F` plus `U+007F`.

The guard covers the provider values that can influence reservation resource identity, result/warning structure, active-offer scope, hotel segment identity, property/stay matching, receipt ownership, or returned provider correlation. In the current parser this includes `Result` and `Warning` discriminators, `ReservationDetail`, `Offer`, offer IDs, product discriminators, `PropertyKey`, chain/property codes, stay dates, receipt `OfferRef` values, and the bounded response trace value.

The parser does not trim malformed machine evidence into authority. For example, `" ReservationDetail"`, `"O1 "`, or `"2026-10-10 "` fail closed instead of becoming the canonical values used by the durable reservation comparison.

## Human text remains separate

Travelport warning `Message` is free-form provider text, not an identifier or discriminator. It therefore keeps bounded outer-whitespace compatibility while independently rejecting ASCII control characters. This avoids coupling harmless message formatting to commercial identity rules while preserving the existing log/header-injection safety boundary.

The parser does not return warning text in normalized reservation evidence.

## Why this matters

Travelport's current Hotel Retrieve example returns canonical machine values such as `ReservationDetail`, `Offer`, `ProductHospitality`, `PropertyKey`, offer `O1`, and exact property/date values. It also binds receipt evidence to offer IDs. Treating those fields as exact provider evidence prevents two differently encoded provider values from collapsing onto one SF reservation identity.

The shared receipt inspector already applies the same exact-token principle to Stays-owned locator, status, discriminator, source, and supported `OfferRef` evidence. This change aligns the surrounding known-locator response/segment parser with that boundary instead of leaving a normalization gap before receipt validation.

## Validation

Focused regression coverage verifies the canonical Retrieve shape and rejects padded result/warning/reservation/offer/product/property-key/property/date machine evidence. Correlation regression coverage verifies padded and control-bearing trace text is discarded rather than normalized. A separate warning-text regression preserves bounded outer-whitespace compatibility while rejecting control characters.

A dependency-free source contract pins the exact-token guard and keeps warning text on its separate bounded-text path.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Prisma/PostgreSQL scenarios require an explicitly disposable target. Live Travelport behavior still requires provisioned non-production credentials and the reviewed payment authority required by the reservation activation gate.

## Provider reference

Travelport Retrieve Hotel Reservation API Reference:
https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm

Related SF contracts:

- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-known-locator-reservation-type.md`
- `docs/travelport-stays-receipt-token-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
