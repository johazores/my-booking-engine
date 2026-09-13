# Travelport reservation Unicode authority

## Purpose

Travelport reservation identifiers and machine evidence can influence durable supplier identity, recovery decisions, review outcomes, and commercial state. JavaScript strings can contain lone UTF-16 surrogate code units even when a JSON payload is syntactically valid. Those strings are not valid Unicode scalar-value sequences and can fail later URL serialization such as `encodeURIComponent`.

SF therefore rejects ill-formed Unicode at the provider-specific reservation authority boundaries instead of allowing a native runtime exception or malformed provider evidence to travel deeper into the booking lifecycle.

This hardening does not enable the Travelport `reservation` capability and does not change the accepted supplier locator alphabet.

## Request authority

The durable Travelport `providerReservationReference` must be a well-formed JavaScript string in addition to the existing non-empty, already-trimmed, 512-code-unit, and ASCII-control restrictions.

A lone high surrogate or lone low surrogate fails locally as `INVALID_REQUEST` before token acquisition, provider I/O, or URL path serialization. Valid paired non-BMP characters remain accepted when they otherwise satisfy the existing reference rules.

The canonical Retrieve path gate independently percent-decodes the raw locator segment and applies the same reference authority before checking exact `encodeURIComponent` round-trip encoding.

## Response authority

Trace-bound structured reservation responses apply the same Unicode well-formedness requirement to bounded machine strings and provider text before SF serializes the validated response for Create, reviewed Create, Booking.com Sync, or known-locator recovery.

This covers the existing response-authority surface for:

- response trace and result/error/warning strings;
- reservation, offer, product, property, and identifier machine values;
- receipt offer references and locator values;
- locator source/context/type;
- offer status values; and
- bounded provider warning/error message text.

A syntactically valid JSON payload that contains an escaped lone surrogate therefore fails as `INVALID_RESPONSE`; it cannot become durable locator evidence, review/retry classification input, recovery authority, or an SF-owned replay body.

The compatibility parsers remain behind this production machine-authority boundary. This change intentionally strengthens the shared authority gate instead of inventing new provider semantics in each downstream classifier.

## Validation

Focused tests prove that valid non-BMP Unicode remains accepted while lone high and low surrogates are rejected at both durable-reference and response-machine boundaries. The request test also demonstrates the concrete runtime hazard: `encodeURIComponent` throws `URIError` for an ill-formed reference, while SF now classifies that input before serialization.

Dependency-free source contracts pin `String.prototype.isWellFormed()` checks into both the reservation reference boundary and the structured response machine-authority guard. The response contract also pins the current trace -> family/status -> machine authority -> SF serialization -> rebuild ordering so future refactors cannot move replay ahead of validation.

Full repository validation still requires the repository Node 24/TypeScript 6 toolchain. Live Travelport non-production verification remains an independent activation gate.

## References

- `docs/travelport-reservation-reference-route-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-reservation-structured-replay-authority.md`
