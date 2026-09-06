# Travelport Stays Request Tracing

SF keeps Travelport request correlation provider-specific and transport-only. It is observability evidence, not reservation authority and not proof that a supplier write succeeded.

## Version-specific trace headers

Travelport Stays documents different caller-defined request-trace headers by API version:

- v11 Stays requests use `TraceId`.
- v12 SearchComplete/SearchComplete Pagination requests use `TVP-Trace-Id`.
- SF also keeps its existing `E2ETrackingID: sf-<correlation UUID>` support identifier.

Production Travelport adapters are constructed through `loadTravelportStaysIntegration` with `createTravelportStaysTraceFetch`. The wrapper derives the version-specific trace header from the existing SF `E2ETrackingID`, so the two support identifiers cannot silently disagree at the transport boundary.

The wrapper only adds trace headers for HTTPS requests to `api.pp.travelport.net` or `api.travelport.net`. An SF-prefixed malformed correlation ID, unexpected host, or unsupported Stays API path fails closed before transport. OAuth token requests do not carry an SF E2E request correlation and pass through without a Stays trace header.

## Correlation lifetime

Current read adapters generate a fresh UUID for each provider HTTP request. The wrapper preserves that behavior and maps the same UUID into the correct version-specific trace header. The known-locator reservation recovery path is stronger: it already uses the durable `HospitalitySupplierReservationAttempt.id`, so its v11 `TraceId`, E2E tracking value, structured completion record, and durable attempt can be correlated after a timeout or process failure.

Future multi-request supplier write workflows should reuse one durable workflow/attempt correlation where provider semantics require cross-call investigation. This transport helper must not be treated as a substitute for the reservation operation ledger, provider-request-started marker, authoritative provider locator, or reconciliation rules.

## Privacy and security

Trace IDs are opaque UUIDs. They must not contain traveler names, email addresses, payment data, reservation locators, supplier confirmations, credentials, or other business payload data.

The wrapper never logs headers or request bodies and never changes redirect policy. Travelport credential-bearing fetch helpers continue to use manual redirects so credentials are not replayed to a redirect target.

## Capability boundary

This tracing improvement does not enable Travelport `reservation`, `modification`, or `cancellation` capabilities and does not expose any supplier booking action. The real reservation write remains gated by live selected-offer authority validation, a reviewed PCI-safe payment/guarantee strategy, create/change orchestration, authoritative negative lookup semantics, locator-less ambiguity recovery, and provisioned non-production verification.
