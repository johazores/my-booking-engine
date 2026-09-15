# Rental booking foundation

SF now has the first durable rental booking persistence boundary for converting one active physical-unit hold into one confirmed tenant booking, together with a staff-only interaction/read layer for reviewing that authority, confirming it through the existing writer, and reading durable rental booking history. The commercial contract remains intentionally narrow: it establishes durable ownership, commercial evidence, physical-unit allocation, idempotency, inventory protection, auditability, and staff review without inventing payment, deposit, pickup, delivery, return, cancellation, amendment, or customer self-service behavior.

## Durable records

`RentalBooking` stores the tenant, customer identity plus an immutable customer name/contact snapshot, source hold, physical unit, unit type, operating location, stable idempotency key, lifecycle, exclusive-end rental dates, currency, exact minor-unit total, immutable pricing evidence, conversion-authority fingerprint, and confirmation timestamps.

`RentalBookingAllocation` is the physical inventory commitment. It binds one confirmed booking to one tenant-owned physical unit and exact date range. A deferred database constraint requires every confirmed rental booking to finish its transaction with one matching allocation.

The rental booking/customer relationship is modeled in Prisma on both sides and backed by the composite database foreign key `(customerId, organizationId) -> customers(id, organizationId)` with delete restriction. A durable rental booking therefore cannot silently outlive or cross-bind its tenant-owned customer through a direct database delete.

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

## Staff booking interaction

The authenticated hold detail now exposes a real staff conversion workflow only when the actor has the existing conversion permissions. Active-customer lookup is tenant-scoped and bounded, the selected customer is passed through `reviewRentalBookingConversionAuthority`, and the confirm action is only rendered for a ready authority. The browser does not submit organization ID, actor ID, amount, dates, unit identity, pricing snapshot, or idempotency key as commercial authority.

`POST /api/inventory/rentals/holds/[hold-id]/confirm` derives the active tenant and actor from the authenticated server context and derives the stable idempotency key from the route hold plus selected customer. It then calls the existing confirmation writer, which revalidates the full authority inside the serializable write transaction before consuming inventory protection.

`/inventory/rentals/bookings` and `/inventory/rentals/bookings/[booking-id]` provide `booking:read`-protected, organization-scoped staff history and detail. The list is paginated and lifecycle-filterable. The detail shows the retained customer snapshot, physical allocation, source evidence, exact money, and pricing/authority fingerprints. Unsupported downstream commercial actions are intentionally absent. See [rental-booking-staff-workflow.md](./rental-booking-staff-workflow.md).

## Database inventory protection

The migrations add database guards because app-level availability checks alone are insufficient under concurrency or alternative writers.

- Booking insert validates the active tenant customer snapshot, consumed hold evidence, and current unit/type/location ownership.
- The composite customer foreign key permanently binds the booking to the same tenant-owned customer and rejects direct customer deletion while the booking remains.
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

## Customer lifecycle integration

A confirmed rental booking retains an immutable customer name/contact snapshot as part of its commercial evidence. SF therefore treats a rental booking reference as a customer-data retention boundary rather than allowing the mutable customer profile to be de-identified independently.

Both customer-detail eligibility and the final serializable de-identification mutation count tenant-owned hospitality and rental booking references. An archived customer referenced by either supported booking domain receives `BOOKING_REFERENCES`, the destructive action is not offered, and the mutation independently fails closed if a booking appears after the page was rendered.

The rental booking PostgreSQL integration scenario verifies both service-level de-identification rejection and database-level customer-delete rejection after confirmation. Broader booking-linked disposal remains a separate legal/privacy lifecycle concern; the rental booking snapshot is not mutated or deleted by customer profile lifecycle operations.

## Explicit boundaries

This foundation now exposes staff-only conversion review/confirmation plus rental booking list/detail, but it still does not expose a public/customer rental booking route, checkout, provider integration, payment or deposit workflow, delivery/pickup promise, return workflow, tax/fee workflow, cancellation action, amendment/rescheduling action, or fulfillment notification. Those features require their own explicit product and commercial acceptance criteria.

In particular, `CONFIRMED` in this first rental contract means the tenant has durably committed the physical inventory to the customer under the reviewed price. It does not imply that money has been collected or that fulfillment logistics have been agreed.

## Validation

`src/server/bookings/rental-booking-domain.test.ts` covers confirmation input and idempotent payload identity. `scripts/rental-booking-foundation-source-contract.test.mjs` protects the Prisma customer relationship, composite customer foreign-key migration, schema/migration inventory guards, authorization, locking, tenant scope, pricing and authority revalidation, atomic hold consumption, allocation, audit, booked-inventory exclusion, and customer-retention integration. `scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects the staff read/conversion routing and tenant/authority boundary. `src/server/bookings/rental-booking.integration.ts` is registered in the disposable PostgreSQL test runner for concurrency, replay, hold consumption, availability, database inventory-guard verification, rental-linked customer de-identification rejection, and database customer-delete protection.

Full database validation must run through `npm run test:database` with an explicitly disposable PostgreSQL target. The repository-wide validation gate remains `npm run validate` under the Node version declared in `package.json`. No GitHub Actions are required or used.
