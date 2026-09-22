# Payment provider error boundary

## Purpose

SF keeps provider diagnostics behind server-side adapters while returning only provider-neutral operational failures to authenticated product surfaces. A provider response can contain implementation-specific identifiers or text that is useful to the adapter but is not safe presentation authority for a browser.

Payment provider failures also influence durable payment/refund claim settlement and retry behavior. JavaScript prototype identity and TypeScript `readonly` fields are not sufficient machine authority at runtime, so SF brands constructed payment-provider failures privately and makes their machine fields immutable.

## Constructor authority contract

`PaymentProviderError` registers the exact `{ code, retryable }` pair in a module-private `WeakMap` when SF constructs the error. The constructor accepts only the repository-owned `paymentProviderFailureCodes` set and a real boolean retry flag. Invalid runtime values fail before they can become payment-provider authority.

`PaymentProviderError[Symbol.hasInstance]` uses that private registry. Existing `instanceof PaymentProviderError` branches therefore accept only constructor-registered SF payment failures; `Object.create(PaymentProviderError.prototype)` and other structural/prototype lookalikes do not qualify. Revoked proxies and wrapper objects also do not inherit the original error's authority.

The public `code` and `retryable` fields are defined as non-writable and non-configurable. This preserves the existing adapter-owned retry classification—including context-specific `UNKNOWN` and timeout cases—without allowing a caught value to change payment settlement semantics after construction. `inspectPaymentProviderFailure` exposes the same frozen constructor-owned snapshot when an explicit unknown-value inspection boundary is preferable.

This class-level brand protects all existing payment-provider `instanceof` boundaries, including authorization/capture, refund, public Checkout, commercial-amendment charge/refund/recovery settlement, provider reconciliation, and HTTP presentation. Those flows do not need to trust a mutable public retry flag from an arbitrary thrown object.

## Client presentation contract

`src/server/payments/payment-provider-client-error.ts` maps the normalized `PaymentProviderFailureCode` plus constructor-owned retryability into a bounded client-safe message. Authenticated generic payment routes and hospitality booking/payment routes use that mapper instead of forwarding `PaymentProviderError.message`.

The browser may receive only the normalized failure code, retryability, and provider-neutral message. Raw upstream response text, provider request identifiers, payment/refund references, credentials, tokens, payloads, and arbitrary provider error objects are not returned by these shared boundaries. Public Stripe Checkout already uses its own narrower customer-safe error contract and remains unchanged.

Provider-specific classification still belongs inside adapters. The shared client mapper does not inspect Stripe payloads and does not change provider reconciliation, idempotency, tenant scope, authorization, or payment state.

## Cache control

The shared authenticated payment JSON and error helpers return `cache-control: no-store`, including authentication/active-organization precondition responses. This keeps tenant payment history, receipts, provider references, and failure responses from becoming cacheable product API artifacts.

The shared hospitality booking JSON/error helpers and their authentication/active-organization precondition responses also use `no-store`, so booking/payment API behavior cannot leave stale authorization or financial responses in caches.

## Validation

`src/server/payments/payment-provider.test.ts` verifies constructor branding, immutable machine fields, prototype-lookalike rejection, revoked-proxy rejection, the runtime failure-code allowlist, and invalid runtime authority rejection. `src/server/payments/payment-provider-client-error.test.ts` covers every normalized provider failure code and verifies provider-neutral presentation. `src/server/payments/payment-http.test.ts` checks no-store responses, internal-claim redaction, and raw-provider-message suppression. `scripts/payment-provider-error-boundary.test.mjs` is dependency-free source-contract coverage for the constructor authority and both authenticated server HTTP boundaries.

Full Node 24 typecheck/lint/test/build, Prisma validation/migrations, and live PostgreSQL checks remain separate environment gates. GitHub Actions are not used.
