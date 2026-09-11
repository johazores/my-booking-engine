# Travelport Reservation Pre-write Authority

## Purpose

Travelport Create Reservation and Booking.com Sync are external commercial writes. Values that determine the outbound attempt or later prove its result must therefore be fixed before the first asynchronous provider boundary. A caller-owned object must not be able to change reservation identity, correlation, recovery identity, callbacks, or other request authority while OAuth or provider I/O is in flight.

## Materialization boundary

The Create and Sync executors now read their top-level execution inputs into local authority exactly once before OAuth. The expected stay identity is copied into a shared immutable snapshot containing only chain code, property code, arrival, departure, room quantity, and guest quantity. The snapshot is validated before it can cross the provider boundary. Throwing accessors and revoked proxies now fail closed as invalid reservation authority instead of allowing caller-controlled exceptions to escape the materialization boundary.

For Create this materializes the request correlation ID, already-built request material, fresh payment authority, payment-card acquisition callback, expected reservation identity, and durable provider-request marker callback. Both initial Create and the accepted-review Create use the same executor boundary. Card-valid-through checks and post-write response classification consume the immutable expected-reservation snapshot rather than caller-owned state.

For Booking.com Sync this materializes the request correlation ID, opaque recovery reference, supplier confirmation, normalized traveler, expected reservation identity, and durable provider-request marker callback. Request construction happens before OAuth and already returns a frozen provider request. Response classification now uses the same materialized supplier confirmation and expected-reservation authority that created the write.

## Why this fails closed

TypeScript `Readonly` prevents ordinary compile-time assignment but does not make a JavaScript object immutable at runtime. Without materialization, a mutable caller, accessor, proxy, or future refactor could change a property after initial validation but before request serialization, tracing, the durable marker, or response classification. That is a time-of-check/time-of-use problem at a commercial boundary.

The executor contract therefore requires that no authoritative `input.*` property is reread after OAuth begins. Materialization itself is also a fail-closed boundary: malformed values, accessor failures, and revoked proxies do not become provider calls or unstructured exceptions. Provider transport uncertainty after the durable marker remains ambiguous; this change does not add retry authority or alter Travelport recovery semantics.

## Similar-scope review

Known-locator recovery already normalizes the provider locator, correlation ID, and expected reservation into local immutable/normalized values before token acquisition and provider I/O. Create request material and Sync request bodies are already built from frozen provider-specific structures. The server-only payment-card source now applies the same one-read fail-closed rule to its non-sensitive execution context before invoking the future PCI-reviewed capability. No additional reservation-lifecycle occurrence requires the same fix in the current scope.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability. Activation still requires a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034` / locator-less recovery semantics.

Related documentation:

- `docs/travelport-sync-prewrite-identity-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-stays-create-outcome-classification.md`
- `docs/travelport-reservation-payment-card-boundary.md`
