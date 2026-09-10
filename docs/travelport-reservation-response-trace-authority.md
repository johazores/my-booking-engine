# Travelport reservation response trace authority

## Purpose

SF uses the durable supplier-reservation attempt UUID as the outbound Travelport correlation identity. Current Travelport Stays documentation says a caller-supplied tracking ID is returned in both the response header and response payload.

Reservation responses can authorize irreversible commercial state or recovery decisions. The production Travelport integration therefore binds reservation responses back to the exact durable outbound attempt before Create, Booking.com Sync, or known-locator Retrieve evidence reaches its provider-specific classifier/parser.

This hardening does not enable the Travelport `reservation` capability.

## Production rule

For implemented Travelport v11 reservation calls, the shared transport derives `TraceId` from the same `E2ETrackingID: sf-<attempt UUID>` used for SF support correlation. The production integration layers a reservation-only response-correlation wrapper over that restricted transport.

The reservation wrapper recognizes only the exact `/11/hotel/book/reservations` path or descendants below `/11/hotel/book/reservations/`. A raw string prefix such as `/11/hotel/book/reservations-legacy` is not reservation authority and passes through this wrapper unchanged. The shared Travelport transport still owns the independent endpoint allowlist.

For `/11/hotel/book/reservations...` GET/POST responses whose payload can contribute reservation authority, the wrapper requires both:

- the v11 response header `traceId` to exactly equal the outbound attempt UUID; and
- the canonical response payload field `traceId` to exactly equal that same UUID.

A v11 reservation response carrying the v12-only `TVP-Trace-Id` header is contradictory versioned correlation evidence and fails closed even if `traceId` also matches. Travelport currently documents `traceId` as the v11 response header and `tvp-trace-id` only for v12 SearchComplete/SearchComplete Pagination.

The payload must also expose exactly one supported reservation response family (`ReservationResponse` or `ErrorResponse`) before correlation evidence can be accepted.

The response is rejected as invalid when a required trace is missing, null, empty, padded, line-broken, mismatched, uses the undocumented payload `traceID` casing, includes the v12-only response trace header, or appears beside malformed/competing response families.

Authentication (`401`/`403`) and rate-limit (`429`) responses remain status authority so existing token eviction and bounded retry semantics are preserved. Provider/gateway statuses above HTTP 500 likewise remain status-only authority. These responses are not trace-bound, so their body, provider status text, representation headers, trace/correlation headers, and arbitrary provider metadata are not forwarded to reservation consumers. The wrapper creates a fresh bodyless response carrying only the HTTP status plus a bounded `Retry-After` value when one was returned. This prevents uncorrelated metadata from accidentally granting source-code, review, definitive-failure, recovery, provider-correlation, redirect, or representation authority in a current or future consumer.

HTTP 500 is deliberately different: Travelport's current Stays error catalog uses 500 for structured application/business errors, including source code `13034` and several validation outcomes. A 500 reservation response therefore must carry the exact echoed v11 header and payload trace before its `ErrorResponse` can reach the commercial classifier. A generic or malformed 500 without that binding fails closed instead of gaining provider-error authority.

Non-reservation Stays traffic passes through this reservation-only wrapper unchanged; its existing provider-specific parsing and transport policies remain separate.

## Failure semantics

Create Reservation and Booking.com Sync are external writes. Once their durable provider-request marker exists, a missing or mismatched provider trace cannot prove that no supplier write occurred. The existing executor transport boundary therefore keeps such failures ambiguous rather than making them automatically retryable.

The status-only `401`/`403`/`429`/>`500` families also cannot use their unverified body or metadata as post-write commercial evidence. For Create and Sync, the sanitized body therefore reaches the existing classifier as no payload authority and settles fail closed. For known-locator Retrieve, the provider adapter continues to map these statuses directly without parsing a reservation body.

Known-locator Retrieve is read-only. Invalid trace evidence remains an `INVALID_RESPONSE`; it cannot prove `FOUND`, `NOT_FOUND`, or reservation identity.

The same rule applies to HTTP 500 provider bodies. Source-coded 500 evidence can influence review, definitive-failure, or recovery classification only after it is bound to the exact outbound attempt. This is especially important for Travelport `13034`, which is documented as HTTP 500 and participates in SF's locator-less sell-uncertainty handling.

A valid matching trace is still operational evidence only. It never proves a supplier sell, never substitutes for a Travelport PNR or supplier confirmation, and never turns locator-less ambiguity into retry authority.

## Memory and response handling

The shared Travelport transport already bounds Stays responses before this reservation-only wrapper runs. For trace-bound responses, the wrapper consumes that bounded replay once, validates the JSON trace evidence, and rebuilds a response carrying the same status, status text, and headers for the downstream reservation parser. It does not log or persist provider bodies.

For status-only response families, the wrapper deliberately does not consume or expose the provider body downstream. It constructs a new empty response instead of cloning provider response metadata. The only preserved metadata is the numeric HTTP status and a bounded `Retry-After` header when present; malformed or oversized retry metadata is discarded. This keeps the operational signal required for auth/rate/provider-unavailable handling while preventing unrelated provider headers, response representation metadata, unverified traces, and provider status text from crossing the reservation authority boundary.

## Validation

Focused executable tests cover exact success/error-family echoes, HTTP 500 application-error trace binding, response-header omission/mismatch, v12-only response-trace rejection on v11 reservation calls, payload omission/null/mismatch, malformed JSON, undocumented payload trace casing, response preservation, malformed outbound correlation, non-reservation pass-through, reservation-prefix lookalike isolation, and status-only handling for authentication/rate-limit/provider-unavailable responses above 500. Status-only tests use deliberately commercial-looking provider bodies and unrelated correlation/representation metadata and verify that only a bounded `Retry-After` survives beside the numeric status.

The lower-level payload helper separately covers malformed response families and bounded canonical trace parsing. A dependency-free source contract pins production integration wiring so Create, reviewed Create authority, Booking.com Sync, and known-locator recovery continue to receive the response-correlation-protected transport, prevents HTTP 500 from regressing into the status-only bypass, requires bounded allowlisted status-only metadata, rejects v12-only trace headers on v11 reservation responses, and pins the reservation path-segment boundary.

Live Travelport non-production verification remains required before reservation activation.

## References

- Travelport Stays Trace and Transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- Travelport Common Stays API Headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- Travelport Stays API Error Messaging: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelAPIErrors.htm
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-stays-request-tracing.md`
- `docs/travelport-reservation-response-evidence.md`
