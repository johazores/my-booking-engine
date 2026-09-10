# Travelport Stays warning evidence authority

## Purpose

Travelport Stays reservation responses can return `Result` warning evidence even when the HTTP request succeeds. One documented warning is commercially significant: Booking.com can confirm the hotel sell while Travelport fails to finish PNR processing, and Travelport directs the client to complete a Sync using the supplier confirmation.

Because that warning can change SF from an ordinary confirmed outcome into a Sync-recovery workflow, warning evidence is treated as provider authority rather than display-only text.

This contract applies to:

- initial Create Reservation outcome classification;
- reviewed second-Create outcome classification through the same classifier;
- Booking.com Sync response classification through the same commercial boundary; and
- known-locator Retrieve parsing, where malformed warning evidence cannot coexist with otherwise trusted reservation evidence.

It does not enable Travelport reservation capability by itself.

## Current provider shape

Travelport's current Stays error-messaging documentation shows successful warning evidence under `Result` with:

- `Result.@type = Result`;
- singular `Warning` array;
- `Warning.@type = Warning`;
- numeric `StatusCode` values, with the documented Stays warning example using `99`; and
- a string `Message`.

Travelport separately documents the Booking.com sell-success / Travelport-PNR-failure warning:

`Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.`

That exact message can authorize SF's `TRAVELPORT_SYNC_REQUIRED` branch only when the existing reservation, supplier-confirmation, offer-authority, and no-PNR checks also succeed.

## Fail-closed structural rules

SF keeps compatibility for provider/shared-model responses that genuinely omit optional discriminator/status members. Omission is not treated as equivalent to malformed evidence.

When the fields are present:

- `Result.@type` must be a bounded single-line `Result`;
- `Warning.@type` must be a bounded single-line `Warning`;
- `Warning.StatusCode` must be a finite integer from `0` through `999`;
- `Warning.Message` must be a bounded non-empty string without ASCII control characters;
- `Warning` or `Warnings` must contain at least one and no more than 32 entries; and
- singular `Warning` and defensive plural `Warnings` cannot coexist.

Explicit `null`, wrong schema-family values, strings in place of numeric status evidence, fractional/negative/oversized status codes, empty warning arrays, oversized warning arrays, malformed warning records, and control-character-bearing messages all fail closed.

The status bound deliberately validates type and shape without claiming that every Stays warning must use status `99`. Live provider evidence is still required before narrowing that contract further.

## Exact commercial warning comparison

SF no longer collapses arbitrary internal whitespace before comparing the supplier-confirmed/no-PNR message to Travelport's documented recovery warning.

The classifier trims the already bounded message and compares the resulting text case-insensitively by uppercasing it. Tabs and ASCII control characters are rejected before comparison, while multiple internal spaces remain multiple spaces and therefore cannot be normalized into the exact recovery sentence.

This keeps display-compatible generic warnings from accidentally acquiring commercial Sync authority through whitespace rewriting.

## Shared Create, Sync, and Retrieve behavior

`travelport-stays-reservation-create-outcome.ts` validates warning structure before it can promote provider evidence to:

- `CONFIRMED`;
- `TRAVELPORT_SYNC_REQUIRED`;
- provider recovery reference authority; or
- any other commercial reservation outcome.

`travelport-stays-reservation-response.ts` applies the same present-field discriminator, status, cardinality, and message checks before known-locator reservation evidence can be trusted.

The same-scope duplicate implementation is intentionally kept behaviorally aligned because the two modules serve different provider-adapter boundaries: one classifies commercial Create/Sync outcomes and the other normalizes known-locator Retrieve evidence.

## Privacy

Warnings are used only to make fixed SF-owned decisions. Raw warning messages are not persisted as booking business data, logged as provider payloads, or exposed as payment/traveler evidence.

The warning parser does not inspect or persist traveler data, payment-card data, credentials, tokens, request bodies, or response bodies.

## Validation

Focused behavior coverage verifies:

- genuine omission compatibility;
- the current typed `Result` / `Warning` / `StatusCode=99` shape;
- malformed present Result and Warning discriminators;
- malformed warning status codes;
- explicit empty warning collections;
- warning control characters;
- the documented supplier-confirmed recovery sentence; and
- prevention of internal-whitespace normalization into that recovery sentence.

A dependency-free source contract checks that Create/Sync and known-locator Retrieve keep the same fail-closed warning guards.

Full repository validation, PostgreSQL-backed verification, production build, and live Travelport tests remain separate activation requirements.

## References

- Travelport Stays API Error Messaging.
- Travelport Stays APIs Guide, including Syncing Reservations after Aggregator Sell Failure.
- `docs/travelport-stays-create-outcome-classification.md`.
- `docs/travelport-reservation-response-evidence.md`.
