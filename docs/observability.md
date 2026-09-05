# Request correlation and structured logging

SF uses bounded request correlation only where the current production workflow has a concrete operational need. The first protected boundary is legal-document issuance because tax invoices and adjustment notes are immutable commercial writes that need a support-safe way to correlate an HTTP failure with one server completion record.

## Request ID contract

Protected legal-document write routes accept `x-request-id` only when its normalized header value is 8 to 128 characters and contains the bounded identifier alphabet defined in `src/lib/request-correlation.ts`. Missing or invalid values are replaced with a cryptographically random UUID. The selected ID is returned in the `x-request-id` response header on success, validation/auth rejection, conflict, and server failure.

A request ID is correlation metadata only. It grants no authentication, tenant, booking, payment, or legal-document authority and is never used as an idempotency key.

The staff issuance actions append a validated response request ID to visible failure text as a support reference. Successful issuance UX is unchanged.

## Structured completion record

`src/server/observability/request-observability.ts` emits exactly one JSON completion record for each instrumented request. The record contains only an explicit safe whitelist:

- timestamp, level, event, request ID, operation, outcome, HTTP status, and elapsed milliseconds;
- organization ID only after authenticated tenant context has been established;
- optional booking reference or provider code only when a server-owned caller has a safe value;
- legal document type for the current issuance routes.

HTTP 2xx/3xx outcomes log at `info`, 4xx rejections at `warn`, and 5xx failures at `error`. Optional identifier fields fail closed when they do not match the bounded log-safe identifier format.

The initial operations are:

- `hospitality-tax-invoice.issue`;
- `hospitality-cancellation-adjustment-note.issue`;
- `hospitality-commercial-adjustment-note.issue`.

## Data that must never enter these logs

Do not add raw URLs or query strings, request/response bodies, arbitrary request headers, cookies, authorization headers, passwords, bearer/capability tokens, customer names/emails/addresses, card data, API/webhook secrets, provider payloads, legal-document snapshots, or raw caught error objects/messages to this logger. Payment/refund/provider transaction references also require a separate reviewed operational need before they can become structured log fields.

The logger deliberately accepts a typed whitelist rather than arbitrary metadata objects. New fields must preserve that model.

## Operations and future sinks

The JSON line is currently written through the application runtime console so container/process log collection can ingest it without a provider-specific logging dependency. Replacing the transport with a hosted log sink must not change the request-correlation contract or weaken the safe-field whitelist.

Use the response `x-request-id` from a failed staff issuance as the primary correlation key when investigating server logs. Organization ID and operation can narrow the search after authorization has established tenant context.

This logging layer does not replace booking/payment audit history. Audits remain durable business evidence; request logs are operational diagnostics and may follow a separate retention policy.

## Validation

`scripts/request-observability.test.mjs` exercises accepted/rejected correlation IDs, response echo behavior, status/level classification, safe optional-field filtering, forbidden request-data leakage, all three legal-document route integrations, and staff error-reference wiring. Full repository validation still requires the repository Node 24 toolchain; database behavior is unchanged by this logging slice.
