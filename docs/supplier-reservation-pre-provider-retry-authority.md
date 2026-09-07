# Supplier Reservation Pre-Provider Retry Authority

## Purpose

Supplier Create and recovery writes distinguish failures that happen before the durable provider-request marker from failures that happen after an external commercial request may have started. A pre-provider failure can be safe to retry because no supplier write crossed the protected boundary, but that does not mean every pre-provider failure should authorize automatic retry.

## Retry contract

SF now derives pre-provider retry authority from `HospitalitySupplierProviderError.retryable` instead of hardcoding every pre-provider failure as retryable.

The provider-neutral supplier error contract currently authorizes automatic retry only for:

- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `TIMEOUT`

The following typed failures are non-retryable and require corrected configuration, request authority, or a newly prepared operation instead of looping the same attempt:

- `AUTHENTICATION_FAILED`
- `INVALID_REQUEST`
- `INVALID_RESPONSE`

An unexpected application, configuration, or programming failure is normalized to `PRE_PROVIDER_EXECUTION_FAILED` and is also non-retryable. SF does not invent retry authority for an untyped exception.

## Applied write paths

The same boundary is used by both server-only Travelport commercial-write coordinators:

- Create Reservation before its durable provider-request marker;
- Booking.com Sync recovery before its durable recovery-write marker.

After either marker succeeds, this helper is not used. Transport or unexpected uncertainty after the marker remains ambiguous so SF cannot blindly repeat a supplier write.

## Operational effect

This closes a retry-loop defect where authentication failures, invalid requests, invalid responses, integration drift, and unexpected pre-provider exceptions were previously persisted with `retryable=true` merely because the provider write had not started. Transient provider-neutral failures still retain their existing safe retry path.

This change does not enable Travelport reservations, add a route, collect card data, change provider capabilities, or weaken any live-provider/PCI activation gate.
