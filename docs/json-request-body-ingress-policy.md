# JSON request-body ingress policy

SF treats JSON request parsing as an explicit server resource boundary. Production write routes should use a domain-owned bounded reader so malformed or oversized input is rejected before business work begins.

## Implemented boundaries

Public hospitality booking requests and the authenticated hospitality routes listed in `docs/authenticated-hospitality-json-ingress.md` use bounded readers. The authenticated hospitality reader enforces:

- `application/json`;
- strict UTF-8 decoding;
- an advertised `Content-Length` ceiling when present;
- an independent streamed byte ceiling;
- object-only JSON payloads; and
- normalized fail-closed request errors before service execution.

Generic authenticated payment APIs use `readPaymentJsonObject()` with the same transport checks and a 64 KiB default ceiling. The manual payment/refund and Stripe refund/reconciliation routes all pass through that reader.

These transport checks do not replace authentication, same-origin protection, active-tenant resolution, permissions, resource ownership, idempotency, locks, provider truth, settlement authority, or audit behavior.

## Raw JSON parser inventory

No normal production API route currently uses raw `request.json()`.

Stripe webhook ingestion remains separate because signature verification requires the exact raw request body. Its raw-body contract is documented in `docs/stripe-webhook-write-scope.md`.

## Regression rule

`scripts/json-request-ingress-inventory-contract.test.mjs` scans the production API route tree and requires the raw-parser inventory to remain empty.

`scripts/payment-json-ingress-contract.test.mjs` keeps the generic authenticated payment routes on the write-authentication boundary before bounded JSON parsing and requires tenant/actor authority to remain server-derived.

`src/server/payments/payment-http.test.ts` covers the payment reader's object-only parsing, media type, strict UTF-8, and byte-limit behavior.

Full repository validation still requires the repository Node 24.20+ toolchain and the disposable PostgreSQL gates. GitHub Actions are intentionally not used.

## Authenticated payment error classification

Payment HTTP accepts explicitly typed `PaymentInputValidationError` and tenant UUID validation errors for customer-correctable money, idempotency, manual-reference, and refund-amount input. Arbitrary errors containing words such as “required” or “invalid” no longer reveal internal diagnostics or masquerade as HTTP 400; they receive generic HTTP 500 responses. Known conflicts, unavailable resources, and provider failures retain their explicit mappings. Transport errors remain bounded and generic. This does not alter provider settlement authority, refund source selection, or tenant permissions.

## Shared JSON reader and exact-length integrity

The four current JSON ingress policies (public booking, authenticated hospitality, authenticated payments, and public legal-document capabilities) delegate to `src/server/http/bounded-json-body.ts`. The shared transport helper rejects advertised lengths that differ from actual streamed bytes in either direction, including underreported lengths; it also rejects invalid media types, malformed UTF-8, non-object JSON, and byte-limit violations. Each domain wrapper retains its existing public `null` or typed error behavior and its own byte ceiling (64 KiB or 8 KiB). The parser grants no tenant, booking, or payment authority.

`src/server/http/bounded-json-body.test.ts` covers exact lengths, false declarations, streamed limits, malformed JSON, UTF-8, and failing streams. A static route-family contract prevents these wrappers from silently reintroducing duplicated parsers. No GitHub Actions are used.

## Unavailable request streams

The shared JSON reader also rejects an already locked or consumed request body as invalid transport input. A `ReadableStream.getReader()` failure returns `null` to the existing domain wrappers rather than leaking an unexpected exception. The transport layer still does not authenticate or authorize the caller.

Both reader-lock failures and `Request.bodyUsed` are checked. The latter covers a previously consumed stream whose lock was released, rather than relying on `getReader()` to reject all disturbed streams. Focused tests exercise both cases.

## Whole-body deadline and caller abort

The shared JSON ingress reader now uses a 10-second wall-clock deadline for the entire stream acquisition, not a fresh timeout per chunk. A client disconnect/abort or stalled upstream read fails closed as invalid transport input. Cancellation is best-effort and is never awaited, so a hung stream cancellation cannot retain the mutation request. An internal test override may shorten, but cannot extend, the production deadline. This complements the existing byte and chunk limits and does not change authorization or domain error contracts. Regression tests cover stalled reads and caller aborts.

## Rejected unread request cleanup

The shared JSON reader now discards unread request streams best-effort when transport preflight rejects an invalid size policy, timeout override, media type, declared length, or aborted request. The cancellation is never awaited, including when an upstream cancellation promise never settles. Locked or already consumed bodies are not taken away from another reader. This closes the early-rejection resource gap without changing validation, authentication, tenant authorization, or successful JSON parsing. Stripe webhook preflight already has a separate raw-body discard boundary.
