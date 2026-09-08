# Travelport Stays Request Tracing

SF keeps Travelport request correlation provider-specific and transport-only. It is observability evidence, not reservation authority and not proof that a supplier write succeeded.

## Version-specific trace headers

Travelport Stays documents different caller-defined request-trace headers by API version:

- v11 Stays requests use `TraceId`.
- v12 SearchComplete/SearchComplete Pagination requests use `TVP-Trace-Id`.
- SF also keeps `E2ETrackingID: sf-<correlation UUID>` as its provider-support identifier.

Production Travelport adapters are constructed through `loadTravelportStaysIntegration` with `createTravelportStaysTraceFetch`. The wrapper derives the version-specific trace header from the existing SF `E2ETrackingID`, so the two support identifiers cannot silently disagree at the transport boundary.

The wrapper only adds trace headers for HTTPS requests to `api.pp.travelport.net` or `api.travelport.net`. An SF-prefixed malformed correlation ID, unexpected host, or unsupported Stays API path fails closed before transport. OAuth token requests do not carry an SF E2E request correlation and pass through without a Stays trace header.

## Correlation lifetime

Read-only discovery/pricing adapters may use fresh request UUIDs because those calls do not create supplier inventory. Reservation lifecycle work is stronger: Create, reviewed Create, Booking.com Sync, and known-locator Retrieve are correlated to the provider-neutral supplier reservation attempt ledger.

Initial Create, Sync, and reconciliation pass their already-persisted `HospitalitySupplierReservationAttempt.id` as the outbound correlation UUID. Reviewed Create reserves its correlation UUID while accepted authority remains unconsumed and atomically creates the exact marked `CREATE` attempt with that UUID in the immediate pre-POST acceptance-consumption transaction.

The provider-request marker rechecks the exact tenant integration is still active with the same provider, credential version, and reservation capability before a new marked request can begin. This prevents a stale prepared client from crossing the provider boundary after integration disablement or credential rotation.

A durable attempt/correlation is still not proof of provider success. `providerRequestStartedAt`, provider locator/recovery evidence, settlement state, and provider-truth reconciliation remain separate authorities.

## Privacy and security

Trace IDs are opaque UUIDs. They must not contain traveler names, email addresses, payment data, reservation locators, supplier confirmations, credentials, or other business payload data.

The wrapper never logs headers or request bodies and never changes redirect policy. Travelport credential-bearing fetch helpers continue to use manual redirects so credentials are not replayed to a redirect target.

## Capability boundary

This tracing and durable-correlation infrastructure does not enable Travelport `reservation`, `modification`, or `cancellation` capabilities and does not expose a supplier booking action.

The server-only initial Create, explicit price/guarantee review acceptance, one-time reviewed second Create, Booking.com Sync recovery, and known-locator Retrieve boundaries are implemented. Travelport `reservation` remains disabled until SF has a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned account, live non-production end-to-end validation, and authoritative live `13034`/locator-less correlation and retry semantics.
