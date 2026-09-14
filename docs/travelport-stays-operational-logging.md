# Travelport Stays operational logging

## Status

SF emits structured operational request records for the implemented Travelport TripServices Stays transport. This is application logging for provider support and production diagnosis, not product analytics and not an authority for booking, payment, reservation, or retry decisions.

The logger is composed below the Travelport credential-containment boundary. It therefore observes only the exact terminal request after environment, target, route, method, body, header, and credential-containment policy has passed. The logger does not replace those controls.

This complements the existing reservation-create, reservation-sync, and provider-recovery observations. Those domain observations describe reservation outcomes; this transport observation describes the terminal provider request itself.

## Safe log contract

Every terminal Travelport request emits one bounded `supplier.provider-request.completed` record containing only:

- timestamp and log level;
- provider `travelport-stays`;
- configured provider environment;
- internal organization ID;
- internal integration ID and credential version;
- a request-correlation ID;
- the Travelport trace/correlation ID when the terminal request has one;
- a fixed operation name;
- outcome (`succeeded`, `rejected`, or `failed`);
- HTTP status when a response exists;
- elapsed milliseconds; and
- transport failure class (`aborted` or `transport`) when Fetch throws.

Operation names are fixed categories. Opaque SearchComplete/Availability pagination tokens and reservation locator path segments are never copied into log records. IDs are constrained to UUID-shaped values before logging; malformed values are replaced with fixed non-sensitive placeholders.

HTTP 2xx responses are `info/succeeded`, HTTP 3xx/4xx responses are `warn/rejected`, HTTP 5xx responses are `error/failed`, aborted transports are `warn/failed`, and other thrown transports are `error/failed`.

## Prohibited data

The operational logger never records or serializes:

- bearer tokens;
- Travelport username, password, client ID, client secret, or access group;
- request or response headers;
- request or response bodies;
- raw request URLs or query strings;
- pagination tokens or reservation locators;
- traveler/customer identity or other request payload PII;
- provider error bodies; or
- thrown error messages/stacks.

The log sink receives a deliberately narrow structured object. Sink failures are swallowed so logging availability can never become booking or supplier-request authority.

## Correlation

For Stays calls, the logger reuses the already-reviewed terminal `TraceId` or `TVP-Trace-Id` UUID as both provider correlation and request correlation. OAuth token calls do not expose provider trace headers, so SF creates an internal random UUID and leaves `providerCorrelationId` null.

Correlation IDs are support metadata only. They do not authorize tenant access, identify a reservation, establish provider success, or make a write safe to retry. Reservation idempotency and provider-truth recovery remain owned by the existing supplier reservation ledger and reservation executors.

## Composition

`src/server/integrations/travelport-stays-integration.ts` composes the transport in this order:

1. Travelport provider/adapter request;
2. reservation trace/status handling where applicable;
3. Travelport trace/request-policy transport;
4. OAuth credential-containment transport;
5. operational logging transport;
6. terminal Fetch.

This ordering keeps operational logging downstream of secret containment. Connection-health requests use the same ordering against their supplied Fetch implementation.

## Validation

`src/server/suppliers/travelport-stays-operational-log-fetch.test.ts` covers safe successful records, all currently implemented operation categories, opaque pagination/locator non-disclosure, HTTP and thrown transport failures, abort classification, safe identifier fallbacks, and fail-open logging-sink behavior.

`scripts/travelport-stays-operational-logging-contract.test.mjs` locks the production composition and secret-free record/documentation contract without external dependencies.

Repository-required Node 24 execution remains part of the normal local validation gate. GitHub Actions are not used.
