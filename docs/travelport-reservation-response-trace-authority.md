# Travelport reservation response trace authority

## Purpose

SF uses the durable supplier-reservation attempt UUID as the outbound Travelport correlation identity. Current Travelport Stays documentation says a caller-supplied tracking ID is returned in both the response header and response payload.

Reservation responses can authorize irreversible commercial state or recovery decisions. The production Travelport integration therefore binds reservation responses back to the exact durable outbound attempt before Create, Booking.com Sync, or known-locator Retrieve evidence reaches its provider-specific classifier/parser.

This hardening does not enable the Travelport `reservation` capability.

## Production rule

For implemented Travelport v11 reservation calls, the shared transport derives `TraceId` from the same `E2ETrackingID: sf-<attempt UUID>` used for SF support correlation. The production integration layers a reservation-only response-correlation wrapper over that restricted transport.

The reservation wrapper now owns its own exact request-shape gate instead of relying only on the shared transport allowlist. Inside the `/11/hotel/book/reservations` namespace it accepts only the reservation operations that SF has implemented and reviewed:

- `POST /11/hotel/book/reservations/build` with no query for initial Create, or only unique `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` flags for the one reviewed second Create;
- `POST /11/hotel/book/reservations/` with no query for Booking.com Sync; and
- `GET /11/hotel/book/reservations/{AggregatorLocatorCode}` with no query, where the locator is one canonical encoded path segment, for known-locator Retrieve.

Any other method, route, nested path, query parameter, duplicate/false review flag, or non-canonical locator encoding inside that reservation namespace fails as `INVALID_REQUEST` before provider I/O. The exact root path without the Sync trailing slash is not accepted by this wrapper. Travelport's current Stays catalog also exposes other reservation operations in the same namespace, including full-payload Create, modify/cancel, and passive-segment endpoints; those operations are not implemented reservation authority in SF and cannot silently inherit this transport if the shared allowlist changes later.

A raw lookalike such as `/11/hotel/book/reservations-legacy` is outside the reservation namespace and passes through this wrapper unchanged. The shared Travelport transport independently owns the environment/host, credential/header/body, and full Stays endpoint allowlist, so the two layers intentionally fail closed at different boundaries.

For the accepted reservation GET/POST responses whose payload can contribute reservation authority, the wrapper requires both:

- the v11 response header `traceId` to exactly equal the outbound attempt UUID; and
- the canonical response payload field `traceId` to exactly equal that same UUID.

A v11 reservation response carrying the v12-only `TVP-Trace-Id` header is contradictory versioned correlation evidence and fails closed even if `traceId` also matches. Travelport currently documents `traceId` as the v11 response header and `tvp-trace-id` only for v12 SearchComplete/SearchComplete Pagination.

The payload must also expose exactly one supported reservation response family (`ReservationResponse` or `ErrorResponse`) before correlation evidence can be accepted.

After the exact trace is accepted, the same reservation-only wrapper applies a bounded machine-authority guard before rebuilding the response for downstream Create, Sync, or Retrieve parsing. Provider fields that can influence reservation identity or commercial classification must already be canonical. Reservation/offer/product discriminators, offer identifiers, property and stay identity, receipt/locator authority, structured error source/category evidence, and warning text that can select Sync recovery reject leading/trailing whitespace and the full ASCII control range instead of relying on a later compatibility parser to trim or recase them. Error categories are accepted only in the documented uppercase machine form.

The machine-authority traversal repeats the current classifier/parser collection ceilings for offers, products, receipts, errors, and warnings. This prevents the guard itself from turning an already-bounded transport response into unbounded authority traversal.

The response is rejected as invalid when a required trace is missing, null, empty, padded, line-broken, mismatched, uses the undocumented payload `traceID` casing, includes the v12-only response trace header, appears beside malformed/competing response families, or contains normalization-confusable reservation machine authority.

Authentication (`401`/`403`) and rate-limit (`429`) responses remain status authority so existing token eviction and bounded retry semantics are preserved. Provider/gateway statuses above HTTP 500 likewise remain status-only authority. These responses are not trace-bound, so their body, provider status text, representation headers, trace/correlation headers, and arbitrary provider metadata are not authority. In production they are stripped immediately inside the shared transport's raw-response path, before generic Stays response replay buffering inspects or consumes the provider body. The outer reservation wrapper repeats the same bodyless minimization as defense in depth. Both layers preserve only the HTTP status plus `Retry-After` when that value is bounded and valid as RFC delay-seconds or a canonical IMF-fixdate HTTP date. Malformed, non-canonical, control-bearing, or oversized retry metadata is discarded.

HTTP 500 is deliberately different: Travelport's current Stays error catalog uses 500 for structured application/business errors, including source code `13034` and several validation outcomes. A 500 reservation response therefore remains on the normal bounded-body path and must carry the exact echoed v11 header and payload trace and canonical structured error machine evidence before its `ErrorResponse` can reach the commercial classifier. A generic or malformed 500 without that binding fails closed instead of gaining provider-error authority.

Non-reservation Stays traffic passes through the reservation-only response minimizer and trace wrapper unchanged; its existing provider-specific parsing and transport policies remain separate.

## Failure semantics

Create Reservation and Booking.com Sync are external writes. Once their durable provider-request marker exists, a missing/mismatched provider trace or malformed provider machine authority cannot prove that no supplier write occurred. The existing executor transport boundary therefore keeps such failures ambiguous rather than making them automatically retryable.

The status-only `401`/`403`/`429`/>`500` families also cannot use their unverified body or metadata as post-write commercial evidence. For Create and Sync, the sanitized body therefore reaches the existing classifier as no payload authority and settles fail closed. For known-locator Retrieve, the provider adapter continues to map these statuses directly without parsing a reservation body.

Known-locator Retrieve is read-only. Invalid trace or machine evidence remains an `INVALID_RESPONSE`; it cannot prove `FOUND`, `NOT_FOUND`, reservation identity, or supplier lifecycle state.

The same rule applies to HTTP 500 provider bodies. Source-coded 500 evidence can influence review, definitive-failure, or recovery classification only after it is bound to the exact outbound attempt and survives the machine-authority guard. This is especially important for Travelport `13034`, which the current Stays error catalog documents as HTTP 500 / `UNKNOWN` and which participates in SF's locator-less sell-uncertainty handling.

A valid matching trace and structurally canonical machine evidence are still operational/provider evidence only. They never prove a supplier sell by themselves, never substitute for a Travelport PNR or supplier confirmation, and never turn locator-less ambiguity into retry authority.

## Memory and response handling

Structured reservation responses, including HTTP 500 application/business errors, still pass through the shared Travelport response-size boundary. The shared transport consumes the bounded provider body into fixed replay blocks, after which the reservation trace wrapper validates JSON media type, trace, response family/status, and machine-authority evidence and constructs a new downstream response. It preserves only the HTTP status, validated body, validated `Content-Type`, and exact SF-bound v11 `traceId`. Provider status text and every other provider header are intentionally dropped rather than copied. The wrapper does not log or persist provider bodies.

Status-only reservation responses are intentionally different. The production integration inserts a reservation-only raw-response minimizer inside the shared transport. For `401`, `403`, `429`, and statuses above `500`, that inner boundary cancels the unread provider body and creates a fresh bodyless response before generic `Content-Length` validation or 32 MiB replay buffering runs. This means an irrelevant malformed/oversized provider entity cannot turn already-established auth/rate/provider-unavailable status authority into `INVALID_RESPONSE` or consume the reservation response memory budget. Only the numeric HTTP status and a bounded syntactically valid `Retry-After` can survive. The outer reservation wrapper repeats that minimization before the response reaches an executor.

`Retry-After` must be decimal delay-seconds or an exact IMF-fixdate HTTP date; malformed, non-canonical, or oversized retry metadata is discarded. HTTP 500 is excluded from this shortcut because its structured Travelport application/business evidence remains trace-bound commercial/recovery input.

## Validation

Focused executable tests cover the exact implemented request route matrix, including initial/reviewed Create, Sync, and known-locator Retrieve, plus pre-I/O rejection of the unsupported reservation root, passive Create, wrong methods, collection GET, locator POST, nested paths, retrieve queries, unknown/false/duplicate review flags, and non-canonical locator encodings. Reservation-prefix lookalikes remain outside this boundary.

Existing response tests cover exact success/error-family echoes, HTTP 500 application-error trace binding, response-header omission/mismatch, v12-only response-trace rejection on v11 reservation calls, payload omission/null/mismatch, malformed JSON, undocumented payload trace casing, malformed outbound correlation, non-reservation pass-through, and status-only handling for authentication/rate-limit/provider-unavailable responses above 500.

Metadata-authority regression coverage additionally verifies that accepted structured responses expose only `Content-Type` and the exact bound `traceId`, provider status text/arbitrary headers do not survive rebuilding, valid delay-seconds and canonical IMF-fixdate retry values survive status-only rebuilding, and malformed retry values are dropped.

The status-only raw-response regression additionally verifies that reservation `401`/`403`/`429`/>`500` bodies are cancelled and metadata-minimized before shared replay buffering, while HTTP 500 and non-reservation traffic stay on their existing response policy. The source contract pins the production wrapper ordering so a future transport refactor cannot silently move status-only body consumption back ahead of minimization.

The response-machine-authority tests additionally cover exact documented success/error fixtures; normalization-confusable reservation, offer, property, stay, receipt, locator, error source/category, and warning evidence; full ASCII controls; error-category recasing; and response collection ceilings. An integration regression proves the trace-bound reservation wrapper rejects that evidence before returning a response to downstream parsers.

Dependency-free source contracts pin the exact reservation request method/path/query matrix and canonical review/locator encoding alongside production integration wiring, early status-only response minimization, response trace binding, structured response metadata minimization, bounded status-only retry metadata, and machine-authority validation ordering. This makes a future shared-transport endpoint expansion or provider header addition insufficient by itself to authorize a new reservation operation or metadata channel.

Full repository validation still requires the repository Node 24/TypeScript 6 environment. Database-backed supplier scenarios still require an explicitly disposable PostgreSQL target. Live Travelport non-production verification remains required before reservation activation.

## References

- Travelport Stays API Endpoints: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelEndpoints.htm
- Travelport Stays Trace and Transaction IDs: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelTraceTransactionIDs.htm
- Travelport Common Stays API Headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- Travelport Stays API Error Messaging: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelAPIErrors.htm
- Travelport Retrieve Hotel Reservation API: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
- Travelport Sync Reservation API: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
- RFC 9110, Retry-After: https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3
- `docs/supplier-reservation-correlation.md`
- `docs/travelport-stays-request-tracing.md`
- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
