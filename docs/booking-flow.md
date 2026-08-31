# Booking flow

## Status

SF now has a production-safe internal hospitality confirmation boundary. A valid tenant-owned availability hold is converted into a confirmed booking and permanent occupied-night allocation in one serializable PostgreSQL transaction. The same transaction re-reads the current persisted base rates, taxes/fees, and selected add-ons, recalculates the complete exact-money quote, and rejects a stale expected pricing fingerprint before any booking, allocation, hold-consumption, or audit write is committed.

This is still an internal server boundary. Public search, selection, traveler/customer checkout, payment orchestration, confirmation UI, cancellation, and provider-backed reservations remain incomplete and must not be presented as finished.

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

The next booking-flow work is the real application/API journey: search and availability presentation, offer/selection, current price display and revalidation UX, customer/traveler collection, confirmation command exposure with correct error states, and then payment orchestration. Provider-specific reservations remain behind future adapters rather than leaking into this internal booking domain.
