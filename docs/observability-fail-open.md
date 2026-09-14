# Observability fail-open boundary

## Purpose

SF uses structured request and supplier-provider logging for production support, but observability is never booking, payment, tenant, provider-write, reconciliation, or HTTP response authority. A logging subsystem failure must not turn a completed business operation into a failure, trigger a duplicate retry, or replace an otherwise valid response.

This contract applies to the shared HTTP request observer, provider-neutral supplier reservation recovery observation, Travelport reservation Create observation, and Travelport Booking.com Sync observation. The Travelport terminal transport logger already applies the same fail-open rule below credential containment.

## Failure containment

The shared observability safety boundary treats clocks, timestamps, correlation-ID generation, response correlation headers, serialization/log sinks, and console transports as support infrastructure only.

- timing sources that throw or return non-finite values produce a `0` millisecond duration;
- timestamp sources that throw or return an invalid date produce the fixed non-sensitive epoch timestamp `1970-01-01T00:00:00.000Z`;
- a failed or invalid generated HTTP request ID becomes the bounded sentinel `request-id-unavailable` rather than aborting the request;
- inability to attach `x-request-id` to a response does not replace or reject the application response;
- structured-log sink, console, or serialization failures are swallowed at the observability boundary;
- supplier observers remain one-shot even when emission fails, so an attempted log write cannot become retry authority.

These fallbacks deliberately sacrifice diagnostic fidelity rather than application correctness. They contain no customer, traveler, payment, credential, provider payload, reservation locator, idempotency key, or raw error data.

## Authority remains elsewhere

Request IDs and provider correlation IDs are support metadata only. They do not establish authentication, tenant ownership, permissions, provider success, reservation identity, payment state, idempotency, or safe retry authority.

Supplier reservation retry and ambiguity decisions continue to come from the durable supplier reservation operation/attempt ledger and provider-truth recovery. HTTP operation outcomes continue to come from the route/service response. Logging is best-effort evidence around those authorities.

## Scope and validation

`scripts/observability-fail-open.test.mjs` exercises UUID-generation failure, invalid/throwing clocks, invalid timestamps, response-header mutation failure, throwing log sinks, one-shot supplier observation behavior, and shared fail-open composition across the current application/supplier domain observers.

This change does not modify Prisma persistence, supplier capabilities, reservation activation, or provider contracts. Full repository validation still requires the repository Node 24 toolchain. Database-backed checks require an explicitly disposable PostgreSQL target, and live Travelport verification requires provisioned non-production credentials. GitHub Actions are not used.
