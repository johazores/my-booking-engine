# Supplier Reservation Pre-Provider Retry Authority

## Purpose

Supplier Create and recovery writes distinguish failures that happen before the durable provider-request marker from failures that happen after an external commercial request may have started. A pre-provider failure can be safe to retry because no supplier write crossed the protected boundary, but that does not mean every pre-provider failure should authorize automatic retry.

## Retry contract

SF derives pre-provider retry authority from the constructor-registered canonical supplier failure code returned by `inspectHospitalitySupplierProviderFailure`. It does not trust the mutable runtime `HospitalitySupplierProviderError.retryable` field.

The provider-neutral supplier error contract currently authorizes automatic retry only for:

- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `TIMEOUT`

The following recognized failures are non-retryable and require corrected configuration, request authority, or a newly prepared operation instead of looping the same attempt:

- `AUTHENTICATION_FAILED`
- `INVALID_REQUEST`
- `INVALID_RESPONSE`

An unexpected application, configuration, programming, forged, mutated, or hostile failure is normalized to `PRE_PROVIDER_EXECUTION_FAILED` and is also non-retryable. SF does not invent retry authority for an untyped exception or for an object that merely passes `instanceof` through prototype spoofing.

## Applied write paths

The same boundary is used by both server-only Travelport commercial-write coordinators:

- Create Reservation before its durable provider-request marker;
- Booking.com Sync recovery before its durable recovery-write marker.

After either marker succeeds, this helper is not used. Transport or unexpected uncertainty after the marker remains ambiguous so SF cannot blindly repeat a supplier write.

## Operational effect

This closes retry-loop defects where authentication failures, invalid requests, invalid responses, integration drift, unexpected pre-provider exceptions, or forged provider-error lookalikes could otherwise be persisted with retry authority not backed by the repository-owned failure policy. Transient canonical provider-neutral failures still retain their existing safe retry path.

This change does not enable Travelport reservations, add a route, collect card data, change provider capabilities, or weaken any live-provider/PCI activation gate.
