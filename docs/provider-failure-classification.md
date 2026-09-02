# Provider Failure Classification

SF treats provider failures as normal production outcomes and keeps provider-specific payloads behind adapter boundaries.

## Integration health failures

Connection tests expose a safe normalized health status for operators while adapters may retain a more precise failure classification for diagnostics and audit history.

Current normalized integration provider failure codes are:

- `AUTHENTICATION_FAILED` — credentials were definitively rejected by the provider.
- `RATE_LIMITED` — the provider refused the request because of rate limiting.
- `PROVIDER_UNAVAILABLE` — the provider or network path failed without proving an authentication problem.
- `TIMEOUT` — SF's bounded provider request deadline expired before a definitive response was received.
- `INVALID_RESPONSE` — the provider returned a response that could not safely prove the expected operation.

These codes are intentionally secret-safe. Raw provider response bodies, credentials, account data, transport errors, and stack traces must not be placed in browser responses or tenant audit payloads.

## Stripe connection probe

The Stripe integration health probe continues to expose the existing operator-facing health statuses. A timeout remains `PROVIDER_UNAVAILABLE` from an availability perspective, but the result now carries `failureCode: TIMEOUT` so it is not indistinguishable from a network failure or Stripe 5xx response in server-side diagnostics/audit history.

The explicit connection-test audit event stores only provider code, normalized health result, normalized failure code, and credential version. This does not store raw Stripe errors or account information.

A passing health probe proves only that the stored credential authenticated for the documented read-only test request at that moment. It does not prove webhook delivery, future availability, payment settlement, refunds, or account compliance.

## Payment provider failures

Payment adapters retain their payment-specific normalized failure contract because payment operations also need commercial semantics such as `DECLINED`, `DUPLICATE`, and `UNSUPPORTED_OPERATION`. Those provider-specific details remain behind the payment adapter and are not promoted into the generic integration-health vocabulary unless a real cross-provider need is demonstrated.

This separation avoids a speculative universal provider error model while still making authentication, rate limiting, timeout, provider availability, and invalid-response behavior consistent and explicit at the integration boundary.
