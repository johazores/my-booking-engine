# Payment provider error boundary

## Purpose

SF keeps provider diagnostics behind server-side adapters while returning only provider-neutral operational failures to authenticated product surfaces. A provider response can contain implementation-specific identifiers or text that is useful to the adapter but is not safe presentation authority for a browser.

## Client presentation contract

`src/server/payments/payment-provider-client-error.ts` maps the normalized `PaymentProviderFailureCode` plus retryability into a bounded client-safe message. Authenticated generic payment routes and hospitality booking/payment routes use that mapper instead of forwarding `PaymentProviderError.message`.

The browser may receive only the normalized failure code, retryability, and provider-neutral message. Raw upstream response text, provider request identifiers, payment/refund references, credentials, tokens, payloads, and arbitrary provider error objects are not returned by these shared boundaries. Public Stripe Checkout already uses its own narrower customer-safe error contract and remains unchanged.

Provider-specific classification still belongs inside adapters. The shared client mapper does not inspect Stripe payloads and does not change provider reconciliation, idempotency, tenant scope, authorization, or payment state.

## Cache control

The shared authenticated payment JSON and error helpers return `cache-control: no-store`, including authentication/active-organization precondition responses. This keeps tenant payment history, receipts, provider references, and failure responses from becoming cacheable product API artifacts.

The shared hospitality booking JSON/error helpers and their authentication/active-organization precondition responses also use `no-store`, so booking/payment API behavior cannot leave stale authorization or financial responses in caches.

## Validation

`src/server/payments/payment-provider-client-error.test.ts` covers every normalized provider failure code and verifies provider-neutral presentation. `src/server/payments/payment-http.test.ts` checks no-store responses, internal-claim redaction, and raw-provider-message suppression. `scripts/payment-provider-error-boundary.test.mjs` is dependency-free source-contract coverage for both authenticated server HTTP boundaries.

Full Node 24 typecheck/lint/test/build, Prisma validation/migrations, and live PostgreSQL checks remain separate environment gates. GitHub Actions are not used.
