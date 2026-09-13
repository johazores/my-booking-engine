# Travelport reservation status-only response authority

## Purpose

Travelport reservation authentication, rate-limit, and provider/gateway failures can establish operational status without establishing commercial reservation evidence. SF therefore treats HTTP `401`, `403`, `429`, and statuses above `500` as status-only authority for the implemented Stays reservation routes.

This boundary is intentionally separate from structured reservation evidence. HTTP `500` is not status-only because current Travelport Stays error responses can carry structured application/business evidence, including source code `13034`, that must remain trace-bound and machine-validated before it can affect durable recovery or review state.

## One shared minimizer

The raw reservation response wrapper and the outer reservation trace wrapper now use the same provider-specific status predicate and rebuilding function. This prevents the two transport layers from drifting on which statuses bypass structured payload parsing, which metadata may survive, or whether an unread provider body is cancelled.

For a status-only response the shared minimizer:

- keeps only the numeric HTTP status;
- preserves `Retry-After` only when it is bounded and canonical as decimal delay-seconds or an IMF-fixdate value;
- discards provider status text, content metadata, trace/correlation headers, cookies, and every other provider header;
- cancels an unread provider body best-effort; and
- returns a fresh bodyless response.

The inner raw-response wrapper runs before generic Stays `Content-Length` inspection and replay buffering, so an irrelevant malformed or oversized error entity cannot consume the 32 MiB structured-response budget or replace already-established auth/rate/provider-unavailable status authority with a body-framing error. The outer trace wrapper repeats the same shared minimizer as defense in depth when used with any compatible fetch implementation.

## Structured HTTP 500 remains separate

HTTP `500` stays on the bounded structured-response path. It must carry the exact v11 response trace authority, a supported response family, matching structured error status, and canonical reservation machine evidence before provider error details can reach Create, reviewed Create, Booking.com Sync, or known-locator recovery classification.

No `500` response gains retry or recovery authority merely because it contains source code `13034`. The existing locator-less activation gate remains unchanged.

## Validation

Focused executable coverage verifies the exact status-only family, early body cancellation, metadata minimization, `Retry-After` validation, HTTP `500` exclusion, non-reservation pass-through, and reservation-prefix lookalike behavior. A dependency-free source contract additionally pins production wrapper ordering and requires the outer trace boundary to reuse the same shared status predicate and rebuilding function rather than maintaining a second copy.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 environment. Database-backed supplier scenarios require an explicitly disposable PostgreSQL target. Live Travelport non-production verification remains required before reservation activation.

## Activation boundary

This hardening does not advertise or enable Travelport `reservation`. Activation still requires the existing Phase 15 gates:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. provisioned live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live `13034` / locator-less correlation and retry semantics.

## Related contracts

- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-reservation-response-family-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/supplier-reservation-correlation.md`
