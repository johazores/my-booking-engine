# Rental booking foundation

SF now has the first durable rental booking persistence boundary for converting one active physical-unit hold into one confirmed tenant booking. This is production infrastructure only: it establishes durable ownership, commercial evidence, physical-unit allocation, idempotency, inventory protection, and auditability without inventing payment, deposit, pickup, delivery, return, cancellation, amendment, or customer self-service behavior.

## Durable records

`RentalBooking` stores the tenant, customer identity plus an immutable customer name/contact snapshot, source hold, physical unit, unit type, operating location, stable idempotency key, lifecycle, exclusive-end rental dates, currency, exact minor-unit total, immutable pricing evidence, conversion-authority fingerprint, and confirmation timestamps.

`RentalBookingAllocation` is the physical inventory commitment. It binds one confirmed booking to one tenant-owned physical unit and exact date range. A deferred database constraint requires every confirmed rental booking to finish its transaction with one matching allocation.

The first lifecycle deliberately persists only `CONFIRMED` and `CANCELLED` states even though the shared booking enum also contains `PENDING_CONFIRMATION`. No rental cancellation action is exposed yet, so production writes in this slice only create confirmed bookings.

## Confirmation writer

`confirmRentalBookingFromHold` is server-only and requires `booking:manage`, `availability:manage`, `inventory:read`, `pricing:read`, and `customer:read` for the authenticated organization.

The writer runs in a serializable transaction and uses two advisory serialization boundaries:

- tenant + booking idempotency key
- tenant + physical rental unit, using the same `sf:rental-unit:` namespace as rental availability writes

Inside those boundaries it uses PostgreSQL `clock_timestamp()` and revalidates all authority rather than trusting the earlier review result. It requires:

- an active, unexpired tenant hold
- an active tenant customer
- the same active physical unit, active unit type, and active operating location
- no overlapping unavailable-date block
- no competing active unexpired hold
- no overlapping non-cancelled rental booking allocation
- complete immutable hold pricing evidence
- current pricing with the same currency, exact minor-unit total, and pricing fingerprint
- an authority fingerprint rebuilt from the current locked evidence that exactly matches the caller-supplied review fingerprint

The hold is consumed with an exact final persistence predicate. Only after successful consumption does the transaction create the booking, allocation, and secret-free audit event. Any failure rolls all of those writes back together.

The booking idempotency key is tenant-local. A replay returns the existing booking only when the requested hold, customer, and authority fingerprint are exactly the same. Reuse for different commercial authority fails closed. Serializable and uniqueness races are retried within a small bounded loop; they are never treated as successful without re-reading durable evidence.

## Database inventory protection

The migration adds database guards because app-level availability checks alone are insufficient under concurrency or alternative writers.

- Booking insert validates the active tenant customer snapshot, consumed hold evidence, and current unit/type/location ownership.
- Commercial and ownership evidence on a rental booking is immutable after creation.
- Allocation writes take the same per-unit advisory lock and reject overlapping blocks, effective holds, or non-cancelled booking allocations.
- A deferred constraint prevents a confirmed booking from committing without its exact allocation.
- Rental hold creation rejects dates already allocated to a non-cancelled booking.
- Rental unavailable-date blocks reject dates already allocated to a non-cancelled booking.
- Rental unit location, type, or lifecycle changes reject active/future non-cancelled allocations.

These database guards complement, rather than replace, tenant-scoped server authorization and transaction-level revalidation.

## Availability integration

Rental availability now excludes overlapping non-cancelled booking allocations in addition to unavailable-date blocks and active unexpired holds. Effective-hold time comparisons use the database clock inside the serializable availability read.

The conversion-authority review also treats an overlapping non-cancelled booking allocation as an inventory conflict, so a stale hold can never be presented as conversion-ready merely because it still exists.

## Explicit boundaries

This foundation does not expose a new booking page, public route, checkout, provider integration, fake payment flow, deposit workflow, delivery/pickup promise, return workflow, tax/fee logic, cancellation action, amendment action, or notification. Those features require their own explicit product and commercial acceptance criteria.

In particular, `CONFIRMED` in this first rental contract means the tenant has durably committed the physical inventory to the customer under the reviewed price. It does not imply that money has been collected or that fulfillment logistics have been agreed.

## Validation

`src/server/bookings/rental-booking-domain.test.ts` covers confirmation input and idempotent payload identity. `scripts/rental-booking-foundation-source-contract.test.mjs` protects the schema, migration guards, authorization, locking, tenant scope, pricing and authority revalidation, atomic hold consumption, allocation, audit, and booked-inventory exclusion. `src/server/bookings/rental-booking.integration.ts` is registered in the disposable PostgreSQL test runner for concurrency, replay, hold consumption, availability, and database inventory-guard verification.

Full database validation must run through `npm run test:database` with an explicitly disposable PostgreSQL target. The repository-wide validation gate remains `npm run validate` under the Node version declared in `package.json`. No GitHub Actions are required or used.
