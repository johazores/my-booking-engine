# Travelport reservation response evidence

## Purpose

SF has one provider-specific parser for the durable evidence that can be trusted from Travelport Stays reservation responses. Known-locator Hotel Retrieve uses it today, and a future Create Reservation executor can use the same parser after the PCI/payment and live-provider gates are satisfied.

This remains a read/recovery boundary. No Travelport reservation POST, cancellation call, browser route, staff/customer reserve action, or `reservation` capability is added here.

## Normalized evidence

`parseTravelportStaysReservationResponse` accepts an untrusted Travelport response body and returns only the single Travelport aggregator locator, at most one supplier confirmation reference for the current single-room contract, and a bounded correlation/trace identifier. Traveler data, contact details, form-of-payment fields, card data, payment payloads, comments, offer bodies, and raw provider payloads are discarded.

The parser requires exactly one unique Travelport aggregator locator. Multiple distinct Travelport locators or multiple supplier confirmation references fail closed as `INVALID_RESPONSE`. Locator and correlation strings are bounded and must not contain line breaks.

## Retrieve versus future create semantics

Known-locator Hotel Retrieve supplies `expectedProviderReservationReference`, so the response locator must exactly equal the requested locator. Retrieve does not require the current receipt to be `Confirmed`; a cancelled or otherwise historical provider record is still proof that the locator exists and must never be misclassified as safe-to-retry non-existence.

A future Create Reservation executor must call the parser with `requireConfirmedTravelportReceipt: true`. That mode requires a confirmed Travelport receipt and confirmed supplier receipt when one is present. `Pending`, `Rejected`, `Cancelled`, missing, duplicated, or malformed confirmation state fails closed rather than becoming a successful SF reservation.

## Durable ledger evidence

The supplier reservation ledger now persists the optional supplier confirmation reference atomically with a confirmed create or successful `FOUND` reconciliation. This evidence is tenant-scoped and bounded to the same 512-character single-line operational-reference contract as the provider locator. It is not written to audit payloads or structured logs.

An ambiguous create may retain a known Travelport aggregator locator even though the operation is not confirmed. That locator is recovery authority only. Locator-less ambiguity remains `AMBIGUOUS` and cannot enter automatic Hotel Retrieve reconciliation.

Known-locator reconciliation requires the provider to return the exact same aggregator locator before the operation can become `CONFIRMED`. A transient provider failure maps to `UNKNOWN` and preserves the known locator so recovery can be retried. An authoritative `NOT_FOUND` clears the locator and supplier confirmation evidence before returning the operation to `PREPARED`.

The supplier confirmation reference is now durable evidence for future lifecycle work, but cancellation is still not implemented or advertised. Any cancellation capability must separately validate Travelport cancellation semantics, authorization, idempotency, external-write recovery, and live non-production behavior.

## Validation

Dependency-free tests cover confirmed response evidence, known-locator matching, non-confirmed rejection, locator/reference cardinality, unsafe provider strings, and privacy minimization. The reservation reconciliation source contract also verifies atomic supplier-confirmation persistence, known-locator preservation across `UNKNOWN`, exact-locator matching on `FOUND`, and the provider-neutral coordinator ordering provider I/O after tenant-authorized ledger claim.

A guarded PostgreSQL scenario covers locator-less denial, known-locator `FOUND`, supplier confirmation durability, transient recovery retry, `NOT_FOUND` clearing, locator mismatch rejection, and cross-tenant provider-I/O suppression when a disposable database target is available.

Live Create Reservation response validation remains blocked on provisioned Travelport non-production credentials and a reviewed PCI-safe form-of-payment/guarantee strategy. No source-only test is claimed as live-provider evidence.

## References

- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
