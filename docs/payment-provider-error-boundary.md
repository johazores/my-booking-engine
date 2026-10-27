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

`src/server/payments/payment-provider-client-error.ts` is the application-owned presentation boundary. Staff-facing generic payment routes and hospitality booking/payment routes call `paymentProviderClientErrorFromThrown`, which starts from `inspectPaymentProviderFailure` and then maps the frozen constructor-owned code/retryability to a bounded provider-neutral message. Structural lookalikes and arbitrary thrown values receive no payment-provider presentation authority from this boundary; when it returns `null`, callers continue through their existing non-provider error handling.

Staff APIs may receive only the normalized failure code, retryability, and provider-neutral message. Raw upstream response text, provider request identifiers, payment/refund references, credentials, tokens, payloads, and arbitrary provider error objects are not returned by these shared provider-failure branches.

Public Stripe Checkout intentionally exposes less provider authority. `publicPaymentProviderClientError` treats a branded retryable failure as temporary payment unavailability. It treats only an explicit branded `DECLINED` failure as a customer rejection. Every other branded non-retryable provider failure—including authentication/configuration, invalid-request, duplicate/idempotency, unsupported-operation, and unknown classes—becomes generic payment unavailability rather than implying that the customer or card was rejected.

The public Checkout response never exposes the payment-provider failure code or raw provider message. This avoids leaking internal provider classification and prevents configuration or integration failures from being mislabeled as customer declines.

Provider-specific classification still belongs inside adapters. The client presentation boundary does not inspect Stripe payloads and does not change provider reconciliation, idempotency, tenant scope, authorization, payment state, or retry authority.

## Cache control

The shared authenticated payment JSON and error helpers return `cache-control: no-store`, including authentication/active-organization precondition responses. This keeps tenant payment history, receipts, provider references, and failure responses from becoming cacheable product API artifacts.

The shared hospitality booking JSON/error helpers and their authentication/active-organization precondition responses also use `no-store`, so booking/payment API behavior cannot leave stale authorization or financial responses in caches. Public Stripe Checkout error responses also remain `no-store`.

## Validation

`src/server/payments/payment-provider.test.ts` verifies constructor branding, immutable machine fields, prototype-lookalike rejection, revoked-proxy rejection, the runtime failure-code allowlist, and invalid runtime authority rejection. `src/server/payments/payment-provider-client-error.test.ts` covers every normalized provider failure code, verifies constructor-authority materialization, rejects structural lookalikes, and checks the narrower public Checkout disposition contract. `src/server/payments/payment-http.test.ts` checks no-store responses, internal-claim redaction, raw-provider-message suppression, and fail-closed provider presentation for a forged provider lookalike. `scripts/payment-provider-error-boundary.test.mjs` is dependency-free source-contract coverage for constructor authority, staff presentation boundaries, the public Checkout boundary, and response cache policy.

Full Node 24 typecheck/lint/test/build, Prisma validation/migrations, and live PostgreSQL checks remain separate environment gates. GitHub Actions are not used.

## Stripe ambiguous conflict recovery

The Stripe adapter preserves payment-write uncertainty for an in-flight idempotency-key conflict (HTTP 409 or `idempotency_key_in_use`), external-dependency failure (HTTP 424), and a 402 without definitive card-decline evidence. Those conditions are retryable provider failures, so the existing durable-claim services must not mark the payment/refund/Checkout operation definitively failed merely because Stripe returned one of these statuses. Explicit mismatched-parameter `idempotency_error` remains non-retryable. Public presentation stays generic and never exposes the upstream message or idempotency key. See `docs/stripe-api-transport-policy.md` for the provider-specific classification and recovery limits.

## Stripe HTTP error authority and actionable card failures

Stripe documents HTTP 400 as a bad request, HTTP 402 as a failed payment request, HTTP 404 as a missing resource, HTTP 409 as a possible concurrent idempotency conflict, and `api_error` as a provider-side failure. The payment-write classifier now keeps 400/404 status authority ahead of misleading card-decline hints. A 400 `idempotency_error` still proves mismatched idempotency parameters; a 400 `api_error` instead leaves the durable claim retryable/ambiguous. Atypical 4xx `api_error` failures are also retryable rather than definitive card or request failures. Read-only Stripe lookups apply the same `api_error` distinction while preserving definitive 404 not-found handling.

Only HTTP 402 with coherent card-error evidence can produce a customer `DECLINED` disposition. An explicit `card_declined` or issuer `decline_code` can be accepted when the error type is absent, but contradictory `api_error` or `invalid_request_error` envelopes cannot establish a card decline. `authentication_required`, `payment_intent_action_required`, and `processing_error` (including an issuer `authentication_required` decline code) are treated as retryable unknown payment truth even with `card_error`: these do not prove a terminal customer rejection and may require provider-truth reconciliation or customer action. The existing idempotency and tenant-scoped durable claim machinery remains responsible for recovery; this does not add automatic payment retries or enable a new provider capability.

Focused classifier, PaymentIntent authorization/capture/release/refund, Checkout creation/retrieval, and dependency-free source-contract regressions are checked in. Full Node 24 tests, PostgreSQL, and live Stripe sandbox behavior remain unverified in the automation environment. No GitHub Actions are used.

## Canonical Stripe error-code evidence

Stripe error `type`, `code`, and `decline_code` are machine evidence, not free-form diagnostic text. The shared adapter accepts these fields only as bounded lowercase ASCII tokens (maximum 96 characters, lowercase letter first, followed by lowercase letters, digits, or underscores). Empty, padded, control-containing, Unicode, uppercase, and oversized values do not gain machine classification authority; the human-readable diagnostic message remains separately bounded and is never returned raw to clients.

HTTP 402 with a bare `card_error` type but no valid error code or issuer decline code remains retryable `UNKNOWN`. An incomplete error envelope alone must not definitively fail an idempotent payment claim. A canonical `card_error` code (for example `card_declined` or `expired_card`) or a canonical issuer decline code still permits `DECLINED`, except for the explicitly actionable/ambiguous conditions above. A missing error type can still carry an explicit canonical `card_declined` or issuer decline code. The same parser and classifier serve authorization, capture, release, refunds, and Checkout creation; read-only lookups retain their separate status authority.

Focused unit and adapter regression cases cover malformed machine hints, missing evidence, genuine decline codes, and Checkout/payment write behavior. Full Node 24/Prisma/PostgreSQL/provider execution remains an open environment gate.


If a Stripe error envelope supplies any malformed non-null machine field, it is not treated as a missing field alongside otherwise valid hints. For payment writes, such contradictory machine evidence is retryable `UNKNOWN` after HTTP authentication, timeout, rate-limit, provider-unavailable, and 404 not-found status priority; this also prevents malformed idempotency-code combinations from prematurely failing a durable claim. Read-only lookup HTTP status authority is unchanged.
