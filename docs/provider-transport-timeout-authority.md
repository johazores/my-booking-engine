# Provider transport timeout authority

## Scope

Provider timeout classification can influence durable retry, recovery, reconciliation, and operator-visible failure handling. SF therefore treats timeout as application-owned transport evidence rather than accepting a thrown object's class name or `name` property as authority.

## Stripe

The Stripe payment, hosted Checkout, PaymentIntent reconciliation, and refund reconciliation adapters each create the `AbortController` that bounds their own outbound request. A transport failure is classified as `TIMEOUT` only when that exact controller signal is actually aborted. An arbitrary fetch implementation or upstream transport error cannot become timeout authority merely by throwing an object named `AbortError`; without the local aborted signal it is normalized to retryable provider unavailability.

All four Stripe provider boundaries use the same explicit timeout configuration range: 1,000 through 120,000 milliseconds. Invalid configured values fail during adapter construction rather than creating an unbounded, immediate, or otherwise misleading runtime timeout policy.

Constructor-branded `PaymentProviderError` values remain authoritative and are rethrown before transport normalization. This preserves the repository-owned HTTP/provider error classification while keeping unknown transport failures bounded.

## Travelport operational logging

Travelport operational logging is observational and must never become provider-request authority. Its aborted-versus-transport label is derived only from the effective request signal: an explicit `RequestInit.signal` takes precedence, otherwise the signal carried by a `Request` input is used. The logger does not infer abort state from a thrown `DOMException` or an arbitrary `error.name` value.

This distinction matters for incident analysis without changing commercial settlement: a failed sink remains fail-open, logs still exclude credentials, bearer tokens, request/response bodies, payment card data, opaque locator/pagination values, and raw provider errors, and the original transport error is rethrown unchanged after the observation attempt.

## Validation

`scripts/provider-transport-timeout-authority.test.mjs` is dependency-free source-contract coverage for the Stripe local-signal timeout rule, consistent Stripe timeout bounds, and the Travelport effective-request-signal logging rule. Existing Stripe provider tests and Travelport operational logging tests continue to cover provider normalization and structured observation behavior.

Full Node 24 / TypeScript 6 validation, production build, Prisma checks, and live provider execution remain separate environment gates. GitHub Actions are intentionally not used.
