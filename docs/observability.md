# Request correlation and structured logging

SF uses bounded request correlation on production workflows where operators need to connect an HTTP outcome to one privacy-safe server completion record. Current coverage includes immutable legal-document issuance, authenticated payment reads and mutations, commercial-amendment settlement/provider transport, public Stripe Checkout creation/status polling, and Stripe webhook ingestion.

## Request ID contract

Instrumented routes accept `x-request-id` only when its normalized header value is 8 to 128 characters and contains the bounded identifier alphabet defined in `src/lib/request-correlation.ts`. Missing or invalid values are replaced with a cryptographically random UUID. The selected ID is returned in the `x-request-id` response header on success, validation/auth rejection, conflict, and server failure.

A request ID is correlation metadata only. It grants no authentication, tenant, booking, payment, provider, or legal-document authority and is never used as an idempotency key.

The staff legal-document issuance actions append a validated response request ID to visible failure text as a support reference. Successful issuance UX is unchanged. Payment clients do not need to echo or display a request ID for the server to create a correlated completion record.

## Structured completion record

`src/server/observability/request-observability.ts` emits exactly one JSON completion record for each instrumented request. The record contains only an explicit safe whitelist:

- timestamp, level, event, request ID, operation, outcome, HTTP status, and elapsed milliseconds;
- organization ID only after server-side authentication/tenant authority has been established, or after a Stripe webhook has passed the configured integration and signature-verification boundary;
- optional booking reference or provider code only when a server-owned caller has a reviewed safe value;
- legal document type for the current issuance routes.

HTTP 2xx/3xx outcomes log at `info`, 4xx rejections at `warn`, and 5xx failures at `error`. Optional identifier fields fail closed when they do not match the bounded log-safe identifier format.

Current legal-document operations are:

- `hospitality-tax-invoice.issue`;
- `hospitality-cancellation-adjustment-note.issue`;
- `hospitality-commercial-adjustment-note.issue`.

Current authenticated payment operations are:

- `payment.manual.record`;
- `payment.manual-refund.record`;
- `payment.stripe.reconcile`;
- `payment.stripe-refund.create`;
- `payment.stripe-refund.reconcile`;
- `payment.receipt.read`;
- `payment.transactions.read`.

Current commercial-amendment payment operations are:

- `payment.commercial-amendment.manual-settlement`;
- `payment.commercial-amendment.stripe-checkout.create`;
- `payment.commercial-amendment.stripe-checkout.reconcile`;
- `payment.commercial-amendment.stripe-refund.create`;
- `payment.commercial-amendment.stripe-refund.reconcile`;
- `payment.commercial-amendment.stripe-recovery-checkout.create`;
- `payment.commercial-amendment.stripe-recovery-checkout.reconcile`.

Current public/provider operations are:

- `public-payment.stripe-checkout.create`;
- `public-payment.stripe-checkout.status`;
- `payment.stripe-webhook.ingest`.

For authenticated payment routes, the organization log field is attached only after `requirePaymentApiContext` has returned an authorized active-tenant context. Request-body booking IDs, transaction IDs, idempotency keys, manual references, and query-string selectors are not copied into the request log.

For commercial-amendment payment routes, the organization field is attached only after `requireHospitalityBookingApiContext` has established the authenticated active-tenant write context. Booking IDs, amendment IDs, idempotency keys, manual external references, generated return URLs, and provider references remain operational inputs to the existing transport services and are not copied into request logs. Provider scope uses only the static reviewed `manual` or `stripe` label.

For public Stripe Checkout routes, the logger records the static provider label only. It does not log the organization slug, booking capability, checkout request key, return URL, request body, or any booking selector. These routes continue to rely on the existing public capability and same-origin boundaries for authority.

For Stripe webhooks, the route parameter is not trusted as log context on arrival. The organization field is attached only after `ingestStripePaymentWebhook` has loaded the tenant-scoped Stripe integration and verified the configured webhook signature. The raw webhook body, signature, provider event payload, and provider references are never copied into the request log.

## Data that must never enter these logs

Do not add raw URLs or query strings, request/response bodies, arbitrary request headers, cookies, authorization headers, passwords, bearer/capability tokens, customer names/emails/addresses, card data, API/webhook secrets, provider payloads, legal-document snapshots, or raw caught error objects/messages to this logger. Payment/refund/provider transaction references also require a separate reviewed operational need before they can become structured log fields.

The logger deliberately accepts a typed whitelist rather than arbitrary metadata objects. New fields must preserve that model.

## Operations and future sinks

The JSON line is currently written through the application runtime console so container/process log collection can ingest it without a provider-specific logging dependency. Replacing the transport with a hosted log sink must not change the request-correlation contract or weaken the safe-field whitelist.

Use the response `x-request-id` as the primary correlation key when investigating an instrumented failure. Organization ID and operation can narrow authenticated or verified-provider searches when that context was safely established.

This logging layer does not replace booking/payment audit history. Audits remain durable business evidence; request logs are operational diagnostics and may follow a separate retention policy.

Coverage should continue only through reviewed production boundaries. Do not mechanically instrument a route by copying request data into log scope. Other public/provider surfaces still require their own data-authority and privacy review before additional structured fields or operations are added.

## Validation

`scripts/request-observability.test.mjs` exercises accepted/rejected correlation IDs, response echo behavior, status/level classification, safe optional-field filtering, forbidden request-data leakage, legal-document route integrations, and staff error-reference wiring.

`scripts/payment-request-observability.test.mjs` verifies that authenticated payment and commercial-amendment payment routes attach tenant log context only after their server-side authorization boundaries, public Stripe Checkout routes do not expose capability or route selectors, Stripe webhook tenant context appears only after verified webhook ingestion, and all covered payment responses pass through the shared observation boundary.

Full repository validation still requires the repository Node 24 toolchain. This observability slice does not change the Prisma schema or database persistence contract.
