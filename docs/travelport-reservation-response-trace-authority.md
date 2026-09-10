# Travelport reservation response trace authority

## Purpose

SF uses the durable supplier-reservation attempt UUID as the outbound Travelport correlation identity. Current Travelport Stays documentation says a caller-supplied tracking ID is returned in both the response header and response payload.

Reservation responses can authorize irreversible commercial state or recovery decisions. The production Travelport integration therefore binds reservation responses back to the exact durable outbound attempt before Create, Booking.com Sync, or known-locator Retrieve evidence reaches its provider-specific classifier/parser.

This hardening does not enable the Travelport `reservation` capability.

## Production rule

For implemented Travelport v11 reservation calls, the shared transport derives `TraceId` from the same `E2ETrackingID: sf-<attempt UUID>` used for SF support correlation. The production integration layers a reservation-only response-correlation wrapper over that restricted transport.

For `/11/hotel/book/reservations...` GET/POST responses whose payload can contribute reservation authority, the wrapper requires both:

- the v11 response header `traceId` to exactly equal the outbound attempt UUID; and
- the canonical response payload field `traceId` to exactly equal that same UUID.

The payload must also expose exactly one supported reservation response family (`ReservationResponse` or `ErrorResponse`) before correlation evidence can be accepted.

The response is rejected as invalid when a required trace is missing, null, empty, padded, line-broken, mismatched, uses the undocumented `traceID` casing, or appears beside malformed/competing response families.

Authentication (`401`/`403`) and rate-limit (`429`) responses remain status authority and pass through without payload-trace promotion so existing token eviction and bounded retry semantics are preserved. Provider/gateway statuses above HTTP 500 likewise remain status-only pass-through. HTTP 500 is deliberately different: Travelport's current Stays error catalog uses 500 for structured application/business errors, including source code `13034` and several validation outcomes. A 500 reservation response therefore must carry the exact echoed header and payload trace before its `ErrorResponse` can reach the commercial classifier. A generic or malformed 500 without that binding fails closed instead of gaining provider-error authority.

Non-reservation Stays traffic passes through this reservation-only wrapper unchanged; its existing provider-specific parsing and transport policies remain separate.

## Failure semantics

Create Reservation and Booking.com Sync are external writes. Once their durable provider-request marker exists, a missing or mismatched provider trace cannot prove that no supplier write occurred. The existing executor transport boundary therefore keeps such failures ambiguous rather than making them automatically retryable.

Known-locator Retrieve is read-only. Invalid trace evidence remains an `INVALID_RESPONSE`; it cannot prove `FOUND`, `NOT_FOUND`, or reservation identity.

The same rule applies to HTTP 500 provider bodies. Source-coded 500 evidence can influence review, definitive-failure, or recovery classification only after it is bound to the exact outbound attempt. This is especially important for Travelport `13034`, which is documented as HTTP 500 and participates in SF's locator-less sell-uncertainty handling.

A valid matching trace is still operational evidence only. It never proves a supplier sell, never substitutes for a Travelport PNR or supplier confirmation, and never turns locator-less ambiguity into retry authority.

## Memory and response handling

The shared Travelport transport already bounds Stays responses before this reservation-only wrapper runs. The wrapper consumes that bounded replay once, validates the JSON trace evidence, and rebuilds a response carrying the same status, status text, and headers for the downstream reservation parser. It does not log or persist provider bodies.

## Validation

Focused executable tests cover exact success/error-family echoes, HTTP 500 application-error trace binding, response-header omission/mismatch, payload omission/null/mismatch, malformed JSON, undocumented payload trace casing, response preservation, malformed outbound correlation, non-reservation pass-through, and status-only pass-through for authentication/rate-limit/provider-unavailable responses above 500.

The lower-level payload helper separately covers malformed response families and bounded canonical trace parsing. A dependency-free source contract pins production integration wiring so Create, reviewed Create authority, Booking.com Sync, and known-locator recovery continue to receive the response-correlation-protected transport, and prevents HTTP 500 from regressing into the status-only bypass.

Live Travelport non-production verification remains required before reservation activation.

## References

- Travelport Stays Trace and Transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- Travelport Stays API Error Messaging: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelAPIErrors.htm
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-stays-request-tracing.md`
- `docs/travelport-reservation-response-evidence.md`
