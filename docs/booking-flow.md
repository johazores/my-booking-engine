# Booking flow

## Status

SF now has a production-safe internal hospitality confirmation boundary, authenticated application APIs, and an authenticated booking desk connected to the real booking services. A valid tenant-owned availability hold is converted into a confirmed booking and permanent occupied-night allocation in one serializable PostgreSQL transaction. The same transaction re-reads the current persisted base rates, taxes/fees, and selected add-ons, recalculates the complete exact-money quote, and rejects a stale expected pricing fingerprint before any booking, allocation, hold-consumption, or audit write is committed.

The authenticated booking desk supports an exact property/room-type/rate-plan stay selection, real availability checks, date-applicable add-on selection, temporary holds, complete price review/revalidation, existing-customer selection, atomic confirmation, explicit hold-expiry and price-change recovery, and recent persisted booking history. Broad offer discovery/search, booking-specific traveler/passenger capture, payments, cancellation/modification, and the public white-label booking journey remain incomplete and must not be presented as finished.

## Authenticated booking API

The current internal application boundary uses the active authenticated organization context rather than accepting a tenant identifier from request payloads:

- `POST /api/bookings/hospitality/availability` reads normalized availability for an active property/room-type/rate-plan stay request.
- `POST /api/bookings/hospitality/holds` creates the real idempotent temporary capacity hold.
- `POST /api/bookings/hospitality/quote` returns the current complete exact-money quote and deterministic pricing fingerprint, including selected add-ons.
- `POST /api/bookings/hospitality/confirm` performs price-atomic hold-to-booking confirmation.
- `GET /api/bookings/hospitality` returns tenant-scoped persisted booking history with bounded pagination.

Every state-changing booking-flow endpoint requires an authenticated session, an active organization selected through the server-side tenant context, same-origin request protection, and the service-layer permission required by the operation. Business rules, tenant scope, availability locking, pricing calculation, and persistence remain in server services rather than route handlers.

The API returns explicit authentication, tenant, permission, validation, conflict, unavailable, and price-change failure states. BigInt money values are serialized as decimal strings so JSON transport never loses integer precision.

## Authenticated booking desk

`/bookings` lives in the canonical authenticated application shell and derives the active tenant from the validated server session. The page uses `booking:read` for access and exposes confirmation controls only when the actor also has `booking:manage`. Property, pricing-scope, customer, add-on, and booking-history data are all loaded through existing tenant-scoped services.

The client workspace coordinates the existing API rather than reimplementing commercial rules in the browser:

1. choose an active property and exact room-type/rate-plan scope;
2. enter stay dates and room quantity and request authoritative availability;
3. select add-ons that match the scope and occupied-night date range;
4. create an idempotent capacity hold and fetch the complete server quote;
5. review exact accommodation, tax, fee, add-on, and total amounts;
6. select an active tenant customer; and
7. submit the hold, current pricing fingerprint, selections, customer, and stable booking idempotency key for atomic confirmation.

Hold and booking idempotency keys remain stable across retryable client failures so a lost HTTP response does not create duplicate temporary capacity or duplicate bookings. Changing the commercial stay input starts a fresh hold attempt. Add-on choices are locked after capacity is held so the UI cannot silently abandon a live hold by changing its commercial payload.

When confirmation reports a price change, the UI refreshes the current quote and requires the operator to review it before confirming again. When the hold is unavailable or expired, the workspace clears the stale commercial state and requires a new availability check. Successful confirmation shows the persisted booking identifier, booking state, separate payment state, and immutable total.

This is an internal staff booking desk, not the public white-label customer journey.

## Confirmation command

`src/server/bookings/booking-domain.ts` defines the provider-independent confirmation input. A command references an existing availability hold and active customer, requires an organization-scoped idempotency key, carries the expected SHA-256 complete-pricing fingerprint, and includes normalized add-on selections.

The caller never supplies authoritative money totals. `confirmHospitalityBookingFromHold` derives the immutable snapshot from current persisted pricing inside the confirmation transaction.

## Atomic confirmation

`confirmHospitalityBookingFromHold` requires `booking:manage` and validates tenant/resource identifiers before entering a serializable transaction. It then:

1. serializes the organization/idempotency-key boundary;
2. returns an existing booking only for an exact retry payload;
3. loads the tenant-owned hold and acquires the shared room-type availability allocation lock;
4. re-reads the hold and requires it to remain active and unexpired;
5. verifies the active tenant-owned customer and room-type/rate-plan assignment;
6. recalculates current complete pricing through a transaction-bound pricing reader using current base rates, taxes/fees, and selected add-ons;
7. compares the current deterministic fingerprint with the expected fingerprint and aborts with a price-change error on mismatch;
8. creates the confirmed booking with an immutable exact-money snapshot derived only from the recalculated server quote;
9. creates the permanent booking allocation;
10. marks the hold `CONSUMED`; and
11. writes one safe `booking.confirmed` audit event.

All pricing, booking, allocation, hold, and audit reads/writes above share the same database transaction. A stale price therefore cannot consume inventory or create a partial booking.

## Concurrency and no-overbooking

Hold creation already reserves capacity under the room-type allocation advisory lock. Confirmation takes that same lock before converting held capacity into a permanent allocation, so there is no inventory gap between hold consumption and booking allocation.

Competing confirmation requests for the same final held unit are serialized. Only one request can consume the hold and create the permanent allocation; the other observes the consumed/inactive hold and fails. Exact retries of the winning idempotency key return the existing booking without duplicating allocation or audit records.

The internal hospitality policy remains no overbooking. Availability subtracts active unexpired holds and non-cancelled permanent booking allocations per occupied night.

## Pricing snapshot

Persisted hospitality bookings store:

- currency
- accommodation subtotal minor units
- tax total minor units
- fee total minor units
- add-on total minor units
- total minor units
- complete pricing fingerprint

Amounts are non-negative integer minor units. Total must equal accommodation + tax + fee + add-ons. The snapshot is derived from current database pricing during confirmation and is immutable booking history; later pricing changes do not rewrite it.

## Tenant isolation and authorization

Booking reads and writes always carry `organizationId` server-side. Hold, customer, room type, rate plan, booking, and allocation relations are independently tenant constrained by composite database relationships. Internal booking management requires explicit `booking:read` or `booking:manage` permissions; UI filtering is never used as the security boundary.

## Validation coverage

The disposable PostgreSQL booking integration test covers permission denial, cross-tenant denial, stale-price rejection without consuming the hold, immutable server-derived totals, competing confirmation requests for one held final unit, idempotent retry, permanent allocation visibility in availability, tenant-safe booking reads, bounded listing, and single audit-event persistence.

Full execution still requires the repository's Node 24 runtime and an explicitly disposable PostgreSQL target through the documented local database harness. GitHub Actions are intentionally not part of validation.

## Next dependency

The highest-value remaining booking-flow dependency is broad normalized hospitality search/offer discovery plus booking-specific traveler information where the product requires fields distinct from the tenant customer record. After that, the next major commercial dependency is payment orchestration. The public white-label journey should reuse the same real availability, hold, pricing, and confirmation contracts once its customer-safe authorization model is implemented. Provider-specific reservations remain behind future adapters rather than leaking into this internal booking domain.
