# Travelport Stays Request Tracing

SF keeps Travelport request correlation provider-specific and transport-only. It is observability evidence, not reservation authority and not proof that a supplier write succeeded.

## Version-specific trace headers

Travelport Stays documents different caller-defined request-trace headers by API version:

- v11 Stays requests use `TraceId`.
- v12 SearchComplete/SearchComplete Pagination requests use `TVP-Trace-Id`.
- SF also keeps `E2ETrackingID: sf-<correlation UUID>` as its provider-support identifier.

Production Travelport adapters are constructed through `loadTravelportStaysIntegration` with `createTravelportStaysTraceFetch`. The wrapper is bound to the validated integration environment and derives the version-specific trace header from the existing SF `E2ETrackingID`, so the support identifiers cannot silently disagree at the transport boundary.

The shared transport wrapper is also a fail-closed outbound target boundary. A pre-production integration can reach only the pre-production Travelport API/authentication hosts and a production integration can reach only the production hosts. Stays traffic is accepted only over HTTPS on the default HTTPS port, with no URL userinfo or fragment, an SF-owned `E2ETrackingID` containing a valid UUID, and one of the exact implemented Stays operation shapes below:

- `POST /12/hotel/search/searchcomplete` with no query string;
- `GET /12/hotel/search/searchcomplete/{SearchIdentifier}?pageNumber=2..5`;
- `POST /11/hotel/rules/offershospitality/buildfromrequest` with no query string;
- `POST /11/hotel/availability/catalogofferingshospitality` with no query string;
- `GET /11/hotel/availability/catalogofferingshospitality/{AvailabilityIdentifier}?pageNumber=2..5`;
- `POST /11/hotel/book/reservations/build` with no query string for the initial Create or only `true` acceptance flags (`acceptPriceChangeInd` and/or `acceptGuaranteeChangeInd`) for the reviewed second Create;
- `POST /11/hotel/book/reservations/` with no query string for Booking.com Sync; and
- `GET /11/hotel/book/reservations/{AggregatorLocatorCode}` with no query string for known-locator Retrieve.

Unsupported methods, extra query parameters, duplicate review flags, false review flags, non-canonical path/query encodings that cannot be produced by the adapters, unrelated Stays paths, missing/foreign/malformed correlation, and cross-environment targets all fail before transport. Path identifiers and query strings must use the same canonical adapter encoding before they are accepted. This keeps an adapter defect or injected transport caller from turning Travelport credentials into authority for an API operation SF has not implemented and reviewed.

OAuth is the only uncorrelated exception. It is accepted only as `POST` to the configured environment's fixed `/oauth/token` target, on the default HTTPS port, with no URL userinfo, query, fragment, or `E2ETrackingID`. Stays trace headers are removed from that request. Any other host, alternate port, credentialed URL, method, unsupported path, or unexpected OAuth shape fails closed before credentials can leave the process.

The authenticated integration connection test uses the same environment-bound wrapper around its injectable transport, so validation traffic cannot bypass the production target policy.

## Correlation lifetime

Read-only discovery/pricing adapters may use fresh request UUIDs because those calls do not create supplier inventory. Reservation lifecycle work is stronger: Create, reviewed Create, Booking.com Sync, and known-locator Retrieve are correlated to the provider-neutral supplier reservation attempt ledger.

Initial Create, Sync, and reconciliation pass their already-persisted `HospitalitySupplierReservationAttempt.id` as the outbound correlation UUID. Reviewed Create reserves its correlation UUID while accepted authority remains unconsumed and atomically creates the exact marked `CREATE` attempt with that UUID in the immediate pre-POST acceptance-consumption transaction.

The provider-request marker rechecks the exact tenant integration is still active with the same provider, credential version, and reservation capability before a new marked request can begin. This prevents a stale prepared client from crossing the provider boundary after integration disablement or credential rotation.

A durable attempt/correlation is still not proof of provider success. `providerRequestStartedAt`, provider locator/recovery evidence, settlement state, and provider-truth reconciliation remain separate authorities.

## Privacy and security

Trace IDs are opaque UUIDs. They must not contain traveler names, email addresses, payment data, reservation locators, supplier confirmations, credentials, or other business payload data.

The wrapper never logs headers or request bodies and now forces `redirect: 'manual'` for both OAuth and Stays requests regardless of caller or `Request` redirect policy. Individual credential-bearing Travelport helpers may also specify manual redirects as defense in depth, but the shared environment-bound transport is the final redirect-suppression authority. This prevents Travelport bearer tokens, account headers, OAuth credentials, and reservation credentials from being automatically replayed to a redirect target.

## Capability boundary

This tracing and durable-correlation infrastructure does not enable Travelport `reservation`, `modification`, or `cancellation` capabilities and does not expose a supplier booking action.

The server-only initial Create, explicit price/guarantee review acceptance, one-time reviewed second Create, Booking.com Sync recovery, and known-locator Retrieve boundaries are implemented. Travelport `reservation` remains disabled until SF has a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned account, live non-production end-to-end validation, and authoritative live `13034`/locator-less correlation and retry semantics.
