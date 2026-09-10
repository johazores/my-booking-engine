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

Non-reservation Stays traffic passes through this reservation-only wrapper unchanged; its existing provider-specific parsing and transport policies remain separate. Authentication (`401`/`403`), rate-limit (`429`), and provider-unavailable (`5xx`) responses also remain status authority and pass through without payload-trace promotion so existing token eviction and bounded retry semantics are preserved. Their bodies do not gain reservation authority from this exception.

## Failure semantics

Create Reservation and Booking.com Sync are external writes. Once their durable provider-request marker exists, a missing or mismatched provider trace cannot prove that no supplier write occurred. The existing executor transport boundary therefore keeps such failures ambiguous rather than making them automatically retryable.

Known-locator Retrieve is read-only. Invalid trace evidence remains an `INVALID_RESPONSE`; it cannot prove `FOUND`, `NOT_FOUND`, or reservation identity.

A valid matching trace is still operational evidence only. It never proves a supplier sell, never substitutes for a Travelport PNR or supplier confirmation, and never turns locator-less ambiguity into retry authority.

## Memory and response handling

The shared Travelport transport already bounds Stays responses before this reservation-only wrapper runs. The wrapper consumes that bounded replay once, validates the JSON trace evidence, and rebuilds a response carrying the same status, status text, and headers for the downstream reservation parser. It does not log or persist provider bodies.

## Validation

Focused executable tests cover exact success/error-family echoes, response-header omission/mismatch, payload omission/null/mismatch, malformed JSON, undocumented payload trace casing, response preservation, malformed outbound correlation, non-reservation pass-through, and pass-through status handling for authentication/rate-limit/provider-unavailable responses.

The lower-level payload helper separately covers malformed response families and bounded canonical trace parsing. A dependency-free source contract pins production integration wiring so Create, reviewed Create authority, Booking.com Sync, and known-locator recovery continue to receive the response-correlation-protected transport.

Live Travelport non-production verification remains required before reservation activation.

## References

- Travelport Stays Trace and Transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-stays-request-tracing.md`
- `docs/travelport-reservation-response-evidence.md`
