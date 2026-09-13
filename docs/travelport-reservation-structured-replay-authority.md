# Travelport reservation structured replay authority

## Purpose

Travelport Create Reservation, reviewed Create, Booking.com Sync, and known-locator Retrieve all pass through the reservation trace boundary before provider evidence reaches their compatibility parser or commercial classifier. That boundary already verifies response status/family coherence, v11 trace correlation, JSON media type, and bounded machine authority.

A validated provider body should not then be forwarded downstream as the original provider-controlled JSON text. SF owns the commercial interpretation after validation, so the downstream response must be rebuilt from the exact parsed value that passed the authority checks.

This hardening is provider-specific and does not enable the Travelport `reservation` capability.

## SF-owned structured replay

For trace-bound structured reservation responses, SF now:

1. reads the bounded provider response body through the existing shared transport replay boundary;
2. parses the body as JSON once inside the reservation trace boundary;
3. validates the exact request trace, response family/status relationship, and reservation machine authority against that parsed value;
4. serializes that already-validated parsed value into a new SF-owned JSON body; and
5. returns a fresh `Response` containing only the numeric HTTP status, canonical JSON `Content-Type`, exact SF-bound v11 `traceId`, and the SF-owned serialized body.

The original provider JSON text is not replayed to downstream reservation consumers. Provider formatting, whitespace, and other raw textual representation therefore cannot become a second interpretation surface after the authority checks have completed. Downstream Create, Sync, and Retrieve consumers parse the SF-owned serialization of the same value that the reservation boundary validated.

This is not a claim that arbitrary JSON with duplicate object member names is valid provider evidence. JavaScript JSON parsing resolves the input to one value before machine-authority validation; the production boundary does not expose the original duplicate textual representation downstream or treat raw provider bytes as separate authority.

## Content-Type normalization

The reservation boundary continues to accept only `application/json`, optionally with one UTF-8 charset parameter. Accepted provider casing, optional quoting, or insignificant parameter whitespace is normalized before the response is exposed downstream:

- JSON without a charset becomes exactly `application/json`;
- JSON with an accepted UTF-8 charset becomes exactly `application/json; charset=utf-8`.

Unsupported media types, additional parameters, duplicate charset parameters, non-UTF-8 charsets, control-bearing values, and oversized values still fail closed as `INVALID_RESPONSE`.

This keeps provider-controlled representation formatting out of the downstream response metadata while preserving the same accepted semantic media types.

## HTTP 500 and status-only responses

HTTP 500 remains a structured trace-bound reservation response because Travelport can return application/business error evidence such as source code `13034` at that status. Its validated body is rebuilt through the same SF-owned structured replay path.

The existing `401`, `403`, `429`, and statuses above `500` remain status-only authority. Their provider body is cancelled and discarded before structured parsing, and only the numeric status plus validated `Retry-After` may survive. This change does not broaden those status families or make their bodies authoritative.

## Similar-issue sweep

The current reservation trace wrapper is the only production path that parses a structured Travelport reservation response and then rebuilds a downstream `Response`. The same review also found that the dependency-free response-family source contract still expected an older in-file retry helper even though retry authority had already moved to the shared status-only response module. That contract now reads the shared module directly so future response-boundary refactors cannot drift silently.

No other provider adapter is changed by this contract.

## Validation

Focused behavior coverage verifies that:

- provider JSON formatting is not replayed downstream;
- the downstream body equals the serialization of the parsed and validated response value;
- repeated raw member representation does not survive as repeated downstream JSON text;
- accepted mixed-case or quoted UTF-8 JSON media types are exposed only in canonical SF form; and
- structured HTTP 500 application errors use the same replay boundary.

The dependency-free response-family contract pins the ordering `media type -> parse -> trace -> family/status -> machine authority -> SF serialization -> response rebuild`, the canonical media-type constants, and the shared status-only retry helper location.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live Travelport verification still requires provisioned non-production credentials and the remaining Phase 15 commercial activation gates.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. Activation still requires:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned Travelport account;
2. live non-production SearchComplete -> Rules -> Availability -> initial Create -> reviewed Create -> Sync/recovery verification; and
3. authoritative live `13034` / locator-less correlation and retry semantics.

Related contracts:

- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-reservation-response-family-authority.md`
- `docs/travelport-reservation-null-machine-authority.md`
- `docs/travelport-reservation-response-evidence.md`
