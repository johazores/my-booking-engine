# Stripe API transport policy

## Purpose

SF sends Stripe secret API keys and commercial payment idempotency keys only from server-side provider adapters. Those values are credential and money-movement authority, so outbound Stripe REST calls use one narrow transport boundary instead of relying on ambient Fetch defaults or caller-provided request metadata.

The boundary is `src/server/payments/stripe-api-transport.ts`. It is used by the Stripe integration health probe, PaymentIntent authorization/capture/release/refund adapter, hosted Checkout adapter, PaymentIntent reconciliation, and refund reconciliation.

## Reviewed API surface

The transport accepts only HTTPS requests to `api.stripe.com` with no alternate port, userinfo, query string, or fragment. The implemented operations are intentionally explicit:

- `GET /v1/balance` for the integration health probe;
- `POST /v1/payment_intents` and `POST /v1/payment_intents/{pi}/capture|cancel`;
- `GET /v1/payment_intents/{pi}` for reconciliation;
- `POST /v1/refunds` and `GET /v1/refunds/{re}`;
- `POST /v1/checkout/sessions` and `GET /v1/checkout/sessions/{cs}`.

Adding another Stripe endpoint is a provider-capability change and must update this allowlist deliberately rather than gaining access through a generic URL or Request object.

## Credential and request metadata boundary

GET requests may carry only the Stripe Authorization header. POST requests may carry only Authorization, `Content-Type: application/x-www-form-urlencoded`, and `Idempotency-Key`; a POST without a bounded printable idempotency key or serialized form body fails before network I/O. Provider constructors also apply the same 4,096-character secret-key ceiling as tenant integration configuration.

The serialized POST body is capped at 256 KiB of UTF-8 data. Current SF Stripe operations are much smaller; this is an application-owned resource ceiling so an internal regression cannot turn the credentialed transport into an unbounded request-body channel.

The final Fetch call is projected from reviewed fields instead of spreading arbitrary `RequestInit`. SF forces `cache: no-store`, `credentials: omit`, manual redirects, an empty/no-referrer policy, `keepalive: false`, and empty integrity metadata. The caller-owned abort signal is preserved so the existing local timeout authority remains intact. Framework/runtime extensions such as Next.js fetch metadata or Node/Undici dispatcher fields are not forwarded.

Manual redirects are important at this credential-bearing boundary: SF must observe an unexpected 3xx response and let the provider adapter fail closed rather than automatically following it with the Stripe bearer key, POST body, or idempotency key. Stripe documents secret API keys as authentication credentials that must be protected, and mutating API calls use `Idempotency-Key` for safe operation identity.

## Response resource and deadline boundary

The shared transport does not return to an adapter when only response headers have arrived. It acquires the complete response body first while the caller-owned abort signal remains authoritative. This means the provider adapters' existing timeout remains active through response-body delivery even when an injected test/custom Fetch implementation does not wire its returned stream to that signal.

Stripe REST response bodies are capped at 4 MiB. A malformed or oversized `Content-Length` fails before buffering, and the transport independently counts actual stream bytes so chunked or differently framed responses cannot bypass the ceiling. Provider chunks are copied before retention and the completed body is replayed as an unread response for the existing adapter-specific JSON/status validation path.

Because Fetch runtimes may expose decoded body bytes while retaining wire-representation headers, replay removes `Content-Encoding` and `Content-Length`. Status, status text, media type, Stripe headers, and other response metadata remain available to adapters.

A response-boundary failure occurs after provider I/O may already have happened. SF therefore materializes it as retryable `UNKNOWN` payment-provider evidence rather than a deterministic invalid request. Existing durable payment/refund idempotency and reconciliation paths remain responsible for safe recovery. A caller-owned timeout remains a timeout because the transport throws an abort-shaped error when that signal fires during body acquisition.

## Failure and settlement behavior

This transport boundary does not reinterpret payment success, create new provider-success authority, or weaken tenant/payment locking. Existing provider adapters still own HTTP/error normalization, exact money/reference validation, timeout classification, and durable payment/refund settlement. An unexpected redirect or response remains non-success provider evidence; it is never payment truth.

The boundary also does not add client-side Stripe calls. Raw card data remains outside SF server payment APIs; hosted customer payment remains Stripe Checkout, and provider truth still comes from persisted provider references plus signed callbacks or explicit reconciliation.

## Validation

`src/server/payments/stripe-api-transport.test.ts` exercises the reviewed endpoint matrix, Fetch metadata projection, signal preservation, fail-closed target/header/idempotency rules, request resource bounds, response replay, declared/streamed response ceilings, abort-through-body behavior, and malformed injected transport responses. `scripts/stripe-api-transport-policy-contract.test.mjs` ensures every currently implemented Stripe REST caller uses the shared boundary and that provider secret-key length checks remain aligned. `scripts/stripe-api-transport-resource-contract.test.mjs` pins the request/response ceilings, post-provider failure classification, response-body deadline ownership, replay metadata rules, and documentation.

Full Node 24 / TypeScript 6 repository validation, Prisma validation, production build, disposable PostgreSQL tests, and live Stripe operational validation remain separate environment gates. GitHub Actions are intentionally not used.
