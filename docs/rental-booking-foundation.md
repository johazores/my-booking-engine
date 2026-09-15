# Rental booking foundation

SF now has a durable rental booking persistence boundary for converting one active physical-unit hold into one confirmed tenant booking, a staff-only interaction/read layer for reviewing and confirming that authority, and a staff cancellation lifecycle that releases live inventory while retaining historical booking/allocation evidence. The commercial contract remains intentionally narrow: it establishes durable ownership, commercial evidence, physical-unit allocation, idempotency, inventory protection/release, auditability, and staff review without inventing payment, deposit, pickup, delivery, return, amendment/rescheduling, or customer self-service behavior.

## Durable records

`RentalBooking` stores the tenant, customer identity plus an immutable customer name/contact snapshot, source hold, physical unit, unit type, operating location, stable idempotency key, lifecycle, exclusive-end rental dates, currency, exact minor-unit total, immutable pricing evidence, conversion-authority fingerprint, and confirmation/cancellation timestamps.

`RentalBookingAllocation` is the physical inventory commitment. It binds one booking to one tenant-owned physical unit and exact date range. A deferred database constraint requires every confirmed rental booking to finish its transaction with one matching allocation. Cancellation retains that allocation as historical evidence; inventory guards consider it inactive once the parent booking is `CANCELLED`.

The rental booking/customer relationship is modeled in Prisma on both sides and backed by the composite database foreign key `(customerId, organizationId) -> customers(id, organizationId)` with delete restriction. A durable rental booking therefore cannot silently outlive or cross-bind its tenant-owned customer through a direct database delete.

The supported lifecycle is deliberately narrow: a booking enters as `CONFIRMED` and may transition once to terminal `CANCELLED`. The shared booking enum also contains `PENDING_CONFIRMATION`, but rental persistence does not use it.

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

## Cancellation lifecycle

`cancelRentalBooking` is the server-only inventory-release lifecycle. It requires both `booking:manage` and `availability:manage`, repeats tenant scope on every booking lookup, and runs in a serializable transaction under a tenant/booking lock plus the same physical-unit advisory lock used by rental availability.

Cancellation requires the exact retained physical allocation. The final `CONFIRMED -> CANCELLED` write is an exact compare-and-swap over tenant, lifecycle, observed version timestamp, customer snapshot identity, source hold, unit/type/location, dates, exact money, pricing identity, conversion authority, and confirmation evidence. A successful retry is idempotent.

A database lifecycle trigger takes the same physical-unit lock and permits only the supported terminal transition. Reopening a cancelled booking fails closed. The allocation row is not deleted: it remains historical evidence while every existing live inventory guard ignores allocations whose parent booking is `CANCELLED`. See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Staff booking interaction

The authenticated hold detail exposes a real staff conversion workflow only when the actor has the existing conversion permissions. Active-customer lookup is tenant-scoped and bounded, the selected customer is passed through `reviewRentalBookingConversionAuthority`, and the confirm action is only rendered for a ready authority. The browser does not submit organization ID, actor ID, amount, dates, unit identity, pricing snapshot, or idempotency key as commercial authority.

`POST /api/inventory/rentals/holds/[hold-id]/confirm` derives the active tenant and actor from the authenticated server context and derives the stable idempotency key from the route hold plus selected customer. It then calls the existing confirmation writer, which revalidates the full authority inside the serializable write transaction before consuming inventory protection.

`/inventory/rentals/bookings` and `/inventory/rentals/bookings/[booking-id]` provide `booking:read`-protected, organization-scoped staff history and detail. The list is paginated and lifecycle-filterable. The detail shows the retained customer snapshot, physical allocation, source evidence, exact money, pricing/authority fingerprints, and cancellation evidence when present. A cancellation action is rendered only for a confirmed booking with its retained allocation when the actor has both required management permissions. See [rental-booking-staff-workflow.md](./rental-booking-staff-workflow.md).

## Database inventory protection

The migrations add database guards because app-level availability checks alone are insufficient under concurrency or alternative writers.

- Booking insert validates the active tenant customer snapshot, consumed hold evidence, and current unit/type/location ownership.
- The composite customer foreign key permanently binds the booking to the same tenant-owned customer and rejects direct customer deletion while the booking remains.
- Commercial and ownership evidence on a rental booking is immutable after creation.
- Booking lifecycle updates take the physical-unit lock and allow only terminal `CONFIRMED -> CANCELLED` with a valid cancellation timestamp.
- Allocation writes take the same per-unit advisory lock and reject overlapping blocks, effective holds, or non-cancelled booking allocations.
- A deferred constraint prevents a confirmed booking from committing without its exact allocation.
- Rental hold creation rejects dates already allocated to a non-cancelled booking.
- Rental unavailable-date blocks reject dates already allocated to a non-cancelled booking.
- Rental unit location, type, or lifecycle changes reject active/future non-cancelled allocations.

These database guards complement, rather than replace, tenant-scoped server authorization and transaction-level revalidation.

## Availability integration

Rental availability excludes overlapping non-cancelled booking allocations in addition to unavailable-date blocks and active unexpired holds. Effective-hold time comparisons use the database clock inside the serializable availability read.

The conversion-authority review also treats an overlapping non-cancelled booking allocation as an inventory conflict, so a stale hold can never be presented as conversion-ready merely because it still exists.

When a booking becomes `CANCELLED`, its retained allocation immediately becomes historical/non-blocking for these same inventory decisions. The cancellation service and database lifecycle trigger serialize that release with the physical unit before commit.

## Customer lifecycle integration

A rental booking retains an immutable customer name/contact snapshot as part of its commercial evidence. SF therefore treats a rental booking reference as a customer-data retention boundary rather than allowing the mutable customer profile to be de-identified independently.

Both customer-detail eligibility and the final serializable de-identification mutation count tenant-owned hospitality and rental booking references. An archived customer referenced by either supported booking domain receives `BOOKING_REFERENCES`, the destructive action is not offered, and the mutation independently fails closed if a booking appears after the page was rendered. Cancellation does not erase that reference.

The rental booking PostgreSQL integration scenario verifies both service-level de-identification rejection and database-level customer-delete rejection after cancellation as well as confirmation. Broader booking-linked disposal remains a separate legal/privacy lifecycle concern; the rental booking snapshot is not mutated or deleted by customer profile lifecycle operations.

## Explicit boundaries

This foundation exposes staff-only conversion review/confirmation, rental booking list/detail, and explicit inventory-release cancellation. It still does not expose a public/customer rental booking route, checkout, provider integration, payment or deposit workflow, delivery/pickup promise, return workflow, tax/fee workflow, amendment/rescheduling action, or fulfillment notification. Those features require their own explicit product and commercial acceptance criteria.

`CONFIRMED` means the tenant has durably committed the physical inventory to the customer under the reviewed price. It does not imply that money has been collected or that fulfillment logistics have been agreed. `CANCELLED` means SF no longer treats that physical-unit/date allocation as live inventory protection; it does not imply a refund or other financial action.

## Validation

`src/server/bookings/rental-booking-domain.test.ts` covers confirmation input and idempotent payload identity. `scripts/rental-booking-foundation-source-contract.test.mjs` protects the Prisma customer relationship, composite customer foreign-key migration, schema/migration inventory guards, authorization, locking, tenant scope, pricing and authority revalidation, atomic hold consumption, allocation, audit, booked-inventory exclusion, and customer-retention integration. `scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects the staff read/conversion routing and tenant/authority boundary. `scripts/rental-booking-cancellation-source-contract.test.mjs` protects terminal cancellation, exact write scope, inventory release, staff routing, and the financial/fulfillment boundary. `src/server/bookings/rental-booking.integration.ts` is registered in the disposable PostgreSQL test runner for concurrency, replay, hold consumption, availability, database inventory guards, cancellation/release behavior, tenant isolation, and rental-linked customer retention.

Full database validation must run through `npm run test:database` with an explicitly disposable PostgreSQL target. The repository-wide validation gate remains `npm run validate` under the Node version declared in `package.json`. No GitHub Actions are required or used.
