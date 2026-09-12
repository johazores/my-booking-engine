# Travelport Reservation Pre-write Authority

## Purpose

Travelport Create Reservation and Booking.com Sync are external commercial writes. Values that determine the outbound attempt or later prove its result must therefore be fixed before the first asynchronous provider boundary. A caller-owned object must not be able to change reservation identity, correlation, recovery identity, callbacks, or other request authority while OAuth or provider I/O is in flight.

## Materialization boundary

The Create and Sync executors now read their top-level execution inputs into local authority exactly once before OAuth. The expected stay identity is copied into a shared immutable snapshot containing only chain code, property code, arrival, departure, room quantity, and guest quantity. The snapshot is validated before it can cross the provider boundary. Throwing accessors and revoked proxies now fail closed as invalid reservation authority instead of allowing caller-controlled exceptions to escape the materialization boundary.

For Create this materializes the request correlation ID, already-built request material, fresh payment authority, payment-card acquisition callback, expected reservation identity, and durable provider-request marker callback. Both initial Create and the accepted-review Create use the same executor boundary. Card-valid-through checks and post-write response classification consume the immutable expected-reservation snapshot rather than caller-owned state.

For Booking.com Sync this materializes the request correlation ID, opaque recovery reference, supplier confirmation, normalized traveler, expected reservation identity, and durable provider-request marker callback. Request construction happens before OAuth and already returns a frozen provider request. Response classification now uses the same materialized supplier confirmation and expected-reservation authority that created the write.

The connected Travelport read/review chain now applies the same rule before its public adapters validate or hand input to compatibility cores. Search pagination, exact-property offer search, offer revalidation, Rules review, and reservation authority each copy their declared provider-neutral inputs into a new frozen snapshot. Child ages are copied into a bounded frozen array. Canonical property/offer-reference validation and all later SearchComplete, Rules, Availability, and final revalidation work consume that snapshot rather than rereading caller-owned state.

The Rules and reservation-authority provider constructors also materialize their long-lived authority before compatibility-core construction. Credential fields are copied into a frozen snapshot and top-level cache/dependency/transport options are read once. In particular, the reservation-authority cache key is validated from the same snapshot forwarded to its core, so validation cannot be separated from the token-cache identity by a mutable getter.

## Why this fails closed

TypeScript `Readonly` prevents ordinary compile-time assignment but does not make a JavaScript object immutable at runtime. Without materialization, a mutable caller, accessor, proxy, or future refactor could change a property after initial validation but before request serialization, tracing, the durable marker, response classification, or a later provider revalidation. That is a time-of-check/time-of-use problem at a commercial boundary.

The executor contract therefore requires that no authoritative `input.*` property is reread after OAuth begins. The public pricing/review adapters establish an even earlier boundary: caller-owned authority is materialized before adapter validation and only the materialized snapshot is forwarded to the core. Their connected Rules/reservation-authority constructors now establish the same one-read boundary before long-lived provider state is captured. Materialization itself is fail closed: malformed values, accessor failures, and revoked proxies do not become provider calls or unstructured exceptions. Provider transport uncertainty after a durable write marker remains ambiguous; this change does not add retry authority or alter Travelport recovery semantics.

## Similar-scope review

The same caller-reread pattern existed across the directly connected public supplier boundaries. `TravelportStaysProvider` validated pagination/property/offer authority but then forwarded the original caller object; `TravelportStaysBookingTermsProvider` validated references and forwarded the original revalidation input into Rules plus the final pricing revalidation; and `TravelportStaysReservationAuthorityProvider` validated references and forwarded the original reservation-authority input into the Rules → SearchComplete → Availability chain. All of those request paths now use the shared Travelport input materializer.

A final same-scope review found the related constructor issue in the Rules and reservation-authority wrappers: each wrapper could read or validate one field and then spread the original caller object into its core. Those wrappers now use the constructor materializer and explicit fields. The production integration loader already supplies frozen normalized credentials and a primitive cache key derived from integration id plus credential version, but the public wrapper boundary no longer depends on that upstream discipline for correctness.

Known-locator recovery already normalizes the provider locator, correlation ID, and expected reservation into local immutable/normalized values before token acquisition and provider I/O. Create request material and Sync request bodies are already built from frozen provider-specific structures. The server-only payment-card source applies the same one-read fail-closed rule to its non-sensitive execution context before invoking the future PCI-reviewed capability.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability. Activation still requires a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034` / locator-less recovery semantics.

Related documentation:

- `docs/travelport-stays-input-materialization-authority.md`
- `docs/travelport-stays-constructor-authority.md`
- `docs/travelport-sync-prewrite-identity-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-stays-create-outcome-classification.md`
- `docs/travelport-reservation-payment-card-boundary.md`
