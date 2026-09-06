# Travelport reservation response evidence

## Purpose

SF has one provider-specific parser for the durable evidence that can be trusted from Travelport Stays reservation responses. Known-locator Hotel Retrieve uses it today, and a future Create Reservation executor can use the same parser after the PCI/payment and live-provider gates are satisfied.

This remains a read/recovery boundary. No Travelport reservation POST, cancellation call, browser route, staff/customer reserve action, or `reservation` capability is added here.

## Normalized evidence

`parseTravelportStaysReservationResponse` accepts an untrusted Travelport response body and returns only the single Travelport aggregator locator, at most one supplier confirmation reference for the current single-room contract, and a bounded correlation/trace identifier. Traveler data, contact details, form-of-payment fields, card data, payment payloads, comments, offer bodies, and raw provider payloads are discarded.

The parser requires exactly one unique Travelport aggregator locator. A supplier confirmation reference is accepted only from a locator with both `sourceContext=Supplier` and `locatorType=Confirmation Number`. Multiple distinct Travelport locators or multiple distinct supplier `Confirmation Number` locators fail closed as `INVALID_RESPONSE`. Locator and correlation strings are bounded and must not contain line breaks.

Travelport can return other supplier-owned locator types with different lifecycle meaning. Booking.com examples include a separate `Pin code`, while a canceled reservation changes the supplier locator to `locatorType=Cancellation Number`. Those values are not supplier confirmation numbers and are deliberately excluded from `supplierConfirmationReference`; they are neither treated as ambiguity nor persisted under the wrong semantic field.

## Retrieve versus future create semantics

Known-locator Hotel Retrieve supplies `expectedProviderReservationReference`, so the response locator must exactly equal the requested locator. Retrieve does not require the current receipt to be `Confirmed`; a cancelled or otherwise historical provider record is still proof that the locator exists and must never be misclassified as safe-to-retry non-existence.

A cancelled retrieve may therefore return `FOUND` while `supplierConfirmationReference` is null when Travelport exposes only a supplier `Cancellation Number`. The durable Travelport aggregator locator still proves the reservation record exists, but SF does not relabel cancellation evidence as the original supplier confirmation number.

A future Create Reservation executor must call the parser with `requireConfirmedTravelportReceipt: true`. That mode requires a confirmed Travelport receipt and requires any supplier receipt that qualifies as a `Confirmation Number` to be confirmed. `Pending`, `Rejected`, `Cancelled`, missing, duplicated, or malformed confirmation state fails closed rather than becoming a successful SF reservation. Ancillary supplier locators such as Booking.com `Pin code` are not confirmation evidence and do not create a false multiple-confirmation failure.

## Durable ledger evidence

The supplier reservation ledger now persists the optional supplier confirmation reference atomically with a confirmed create or successful `FOUND` reconciliation. This evidence is tenant-scoped and bounded to the same 512-character single-line operational-reference contract as the provider locator. It is not written to audit payloads or structured logs.

An ambiguous create may retain a known Travelport aggregator locator even though the operation is not confirmed. That locator is recovery authority only. Locator-less ambiguity remains `AMBIGUOUS` and cannot enter automatic Hotel Retrieve reconciliation.

Known-locator reconciliation identity-binds both possible provider-truth outcomes to that durable locator. `FOUND` must return the exact locator before the operation can become `CONFIRMED`. `NOT_FOUND` must also identify the exact locator that was queried before SF can clear recovery evidence and return the operation to `PREPARED`. The coordinator verifies provider output before settlement, and the ledger settlement boundary independently requires and rechecks the locator for both outcomes so direct server callers cannot bypass that invariant. Any provider-returned locator mismatch is normalized to `UNKNOWN` / `INVALID_RESPONSE`; a direct mismatched settlement is rejected transactionally. In either case unrelated provider truth cannot authorize another create. A transient provider failure likewise maps to `UNKNOWN` and preserves the known locator for retry.

The supplier confirmation reference is now durable evidence for future lifecycle work, but cancellation is still not implemented or advertised. Any cancellation capability must separately validate Travelport cancellation semantics, authorization, idempotency, external-write recovery, and live non-production behavior.

## Validation

Dependency-free tests cover confirmed response evidence, known-locator matching, supplier locator-type semantics, non-confirmed rejection, locator/reference cardinality, unsafe provider strings, privacy minimization, coordinator exact-locator gating, and ledger-level `FOUND`/`NOT_FOUND` identity enforcement before any reconciliation can change create retry safety. Parser/provider coverage specifically verifies that a Booking.com-style `Pin code` does not collide with the confirmation number and that a supplier `Cancellation Number` is never persisted as confirmation evidence.

A guarded PostgreSQL scenario covers locator-less denial, known-locator `FOUND`, supplier confirmation durability, transient recovery retry, authoritative `NOT_FOUND` clearing, direct mismatched `NOT_FOUND` settlement rejection, mismatched provider `FOUND`/`NOT_FOUND` results remaining ambiguous, and cross-tenant provider-I/O suppression when a disposable database target is available.

Live Create Reservation response validation remains blocked on provisioned Travelport non-production credentials and a reviewed PCI-safe form-of-payment/guarantee strategy. No source-only test is claimed as live-provider evidence.

## References

- Travelport Stays APIs Guide — confirmations and locator codes: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm
- Travelport Add Hotel Reservation reference payload — Booking.com confirmation number and PIN example: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_AddReservationRefPayload.htm
- Travelport Cancel Hotel Reservation — supplier cancellation-number semantics: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Cancel.htm
- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
