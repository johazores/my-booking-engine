# Payment provider error boundary

## Purpose

SF keeps provider diagnostics behind server-side adapters while returning only provider-neutral operational failures to authenticated product surfaces. A provider response can contain implementation-specific identifiers or text that is useful to the adapter but is not safe presentation authority for a browser.

Payment provider failures also influence durable payment/refund claim settlement and retry behavior. JavaScript prototype identity and TypeScript `readonly` fields are not sufficient machine authority at runtime, so SF brands constructed payment-provider failures privately and makes their machine fields immutable.

## Constructor authority contract

`PaymentProviderError` registers the exact `{ code, retryable }` pair in a module-private `WeakMap` when SF constructs the error. The constructor accepts only the repository-owned `paymentProviderFailureCodes` set and a real boolean retry flag. Invalid runtime values fail before they can become payment-provider authority.

`PaymentProviderError[Symbol.hasInstance]` uses that private registry. Existing `instanceof PaymentProviderError` branches therefore accept only constructor-registered SF payment failures; `Object.create(PaymentProviderError.prototype)` and other structural/prototype lookalikes do not qualify. Revoked proxies and wrapper objects also do not inherit the original error's authority.

The public `code` and `retryable` fields are defined as non-writable and non-configurable. This preserves the existing adapter-owned retry classification—including context-specific `UNKNOWN` and timeout cases—without allowing a caught value to change payment settlement semantics after construction. `inspectPaymentProviderFailure` exposes the same frozen constructor-owned snapshot when an explicit unknown-value inspection boundary is preferable.

This class-level brand protects existing internal payment-provider `instanceof` boundaries, including authorization/capture, refund, public Checkout service settlement, commercial-amendment charge/refund/recovery settlement, and provider reconciliation. This presentation hardening does not change those durable settlement decisions.

## Client presentation contract

`src/server/payments/payment-provider-client-error.ts` is the application-owned presentation boundary. Staff-facing generic payment routes and hospitality booking/payment routes call `paymentProviderClientErrorFromThrown`, which starts from `inspectPaymentProviderFailure` and then maps the frozen constructor-owned code/retryability to a bounded provider-neutral message. Structural lookalikes and arbitrary thrown values do not receive provider-failure presentation authority and remain internal errors.

Staff APIs may receive only the normalized failure code, retryability, and provider-neutral message. Raw upstream response text, provider request identifiers, payment/refund references, credentials, tokens, payloads, and arbitrary provider error objects are not returned by these shared boundaries.

Public Stripe Checkout intentionally exposes less provider authority. `publicPaymentProviderClientError` treats a branded retryable failure as temporary payment unavailability. It treats only an explicit branded `DECLINED` failure as a customer rejection. Every other branded non-retryable provider failure—including authentication/configuration, invalid-request, duplicate/idempotency, unsupported-operation, and unknown classes—becomes generic payment unavailability rather than implying that the customer or card was rejected.

The public Checkout response never exposes the payment-provider failure code or raw provider message. This avoids leaking internal provider classification and prevents configuration or integration failures from being mislabeled as customer declines.

Provider-specific classification still belongs inside adapters. The client presentation boundary does not inspect Stripe payloads and does not change provider reconciliation, idempotency, tenant scope, authorization, payment state, or retry authority.

## Cache control

The shared authenticated payment JSON and error helpers return `cache-control: no-store`, including authentication/active-organization precondition responses. This keeps tenant payment history, receipts, provider references, and failure responses from becoming cacheable product API artifacts.

The shared hospitality booking JSON/error helpers and their authentication/active-organization precondition responses also use `no-store`, so booking/payment API behavior cannot leave stale authorization or financial responses in caches. Public Stripe Checkout error responses also remain `no-store`.

## Validation

`src/server/payments/payment-provider.test.ts` verifies constructor branding, immutable machine fields, prototype-lookalike rejection, revoked-proxy rejection, the runtime failure-code allowlist, and invalid runtime authority rejection. `src/server/payments/payment-provider-client-error.test.ts` covers every normalized provider failure code, verifies constructor-authority materialization, rejects structural lookalikes, and checks the narrower public Checkout disposition contract. `src/server/payments/payment-http.test.ts` checks no-store responses, internal-claim redaction, raw-provider-message suppression, and fail-closed presentation for a forged provider lookalike. `scripts/payment-provider-error-boundary.test.mjs` is dependency-free source-contract coverage for constructor authority, staff presentation boundaries, the public Checkout boundary, and response cache policy.

Full Node 24 typecheck/lint/test/build, Prisma validation/migrations, and live PostgreSQL checks remain separate environment gates. GitHub Actions are not used.
