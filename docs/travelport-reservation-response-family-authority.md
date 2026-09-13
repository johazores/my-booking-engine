# Travelport reservation response family authority

## Purpose

Travelport reservation responses can affect irreversible Create settlement, commercial review, Booking.com Sync recovery, and known-locator reconciliation. The top-level response family and the HTTP status are therefore machine authority, not compatibility hints.

This contract strengthens the existing trace and response-machine guards. It does not enable the Travelport `reservation` capability.

## Family and status contract

After the exact v11 response-header and payload trace have been bound to the durable SF attempt, the reservation transport requires exactly one supported payload family:

- `ReservationResponse` is accepted only with HTTP 2xx status authority.
- `ErrorResponse` is accepted only with structured HTTP 4xx through HTTP 500 status authority.
- every canonical `ErrorDetail.StatusCode` in a structured `ErrorResponse` must exactly equal the trace-bound HTTP response status;
- redirects, success/error family inversions, nested HTTP-status contradictions, and competing/missing response families fail as `INVALID_RESPONSE` before any Create, Sync, or Retrieve classifier receives the body.

The existing status-only path remains separate. HTTP `401`, `403`, `429`, and provider/gateway statuses above `500` do not expose provider body authority downstream. HTTP `500` stays trace-bound because current Travelport Stays error evidence, including `13034`, can use that status.

The downstream Create classifier retains its own `ErrorDetail.StatusCode` equality check as defense in depth. The trace-bound shared transport is now the first production boundary that rejects a body claiming a different HTTP status, so recovery and known-locator paths cannot accidentally receive contradictory structured error authority.

## Nested result contract

The shared response-machine guard also prevents nested commercial evidence from contradicting the top-level family:

- `ReservationResponse` cannot carry `Result.Error` authority.
- `ErrorResponse` must carry a canonical `Result` with at least one canonical `ErrorDetail`.
- `ErrorResponse` cannot carry warning authority.
- `ErrorResponse` cannot also carry reservation authority.
- one result cannot carry both error and warning authority.
- when the production transport supplies HTTP context, each `ErrorDetail.StatusCode` must equal that HTTP status.

Existing exact-token, status-code, category, source-code, trace-alias, collection-bound, reservation identity, receipt, and locator validation continues to apply after the family gate.

## Failure semantics

For Create and Booking.com Sync, a response-family/status contradiction after the durable provider-request marker cannot prove that no external sell occurred. It therefore fails closed through the existing post-provider ambiguity handling rather than becoming automatic retry authority.

Known-locator Retrieve is read-only. A family/status contradiction remains `INVALID_RESPONSE`; it cannot prove `FOUND`, `NOT_FOUND`, or supplier lifecycle state.

This contract deliberately does not invent live semantics for `13034`, locator-less recovery, or any undocumented Travelport response shape.

## Validation

Focused behavior tests cover valid 2xx `ReservationResponse`, valid structured 4xx/500 `ErrorResponse`, redirect rejection, success/error family inversions, and mismatched nested `ErrorDetail.StatusCode` values. Response-machine tests separately cover missing structured error evidence and nested error/warning/reservation family conflicts.

A dependency-free source contract pins validation ordering so trace binding happens first, family/status authority is checked second, the machine-authority guard receives the actual HTTP status, and the response is rebuilt only after those checks succeed.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 environment. Live Travelport reservation verification still requires provisioned non-production credentials and the separately reviewed PCI-safe FormOfPayment/guarantee source.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. The existing activation gates remain unchanged:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery verification; and
3. establish authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-stays-integration.md`
