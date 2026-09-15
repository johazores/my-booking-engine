# Rental booking cancellation

SF implements a staff-only rental booking cancellation lifecycle for the existing durable confirmed rental booking contract. Cancellation is an inventory-release state transition, not deletion and not a financial workflow. It changes one tenant-owned `CONFIRMED` rental booking to `CANCELLED`, records the database cancellation time and audit evidence, retains the booking's immutable commercial/customer evidence and the allocation as historical evidence, and allows the physical unit/date range to participate in new availability decisions again.

## Authority and tenant scope

`cancelRentalBooking` is server-only. It validates the organization, actor, and booking UUIDs and independently requires both:

- `booking:manage`, because the operation changes the durable booking lifecycle
- `availability:manage`, because cancellation releases protected physical inventory

The staff route derives the organization and actor from the authenticated server context. The browser submits only the booking URL through a same-origin authenticated POST. It cannot choose organization identity, actor identity, unit, dates, customer, price, cancellation timestamp, or inventory-release authority.

Every booking read repeats the authenticated `organizationId`. A booking ID from another tenant resolves as unavailable rather than becoming cross-tenant mutation authority.

## Serialization and final write scope

Cancellation runs in a serializable transaction. It first acquires a tenant-and-booking advisory lock and then the same tenant-and-physical-unit advisory lock used by rental availability, hold, block, booking-allocation, and unit-mutation workflows.

After both locks are held, the service uses PostgreSQL `clock_timestamp()` and re-reads the tenant-owned booking with its retained allocation. Cancellation fails closed when the allocation is missing or does not exactly match the booking organization, booking ID, unit, start date, and end date.

The final `CONFIRMED -> CANCELLED` mutation is an exact compare-and-swap. The predicate repeats the tenant, prior lifecycle, null prior cancellation timestamp, observed `updatedAt`, customer snapshot identity, source hold, unit/type/location identity, idempotency key, rental dates, currency, exact total, pricing fingerprint, pricing observation time, authority fingerprint, and confirmation time. If any retained authority changes before the mutation, the write affects zero rows and the request fails as a conflict.

Serializable write conflicts are retried a small bounded number of times. A retry after a successful cancellation is idempotent: the existing cancelled booking and retained allocation are returned without creating a second audit transition.

## Database lifecycle protection

The cancellation migration adds a database lifecycle trigger around `status` and `cancelledAt` changes. The trigger takes the same physical-unit advisory lock and permits only the supported transition from `CONFIRMED` with no cancellation timestamp to `CANCELLED` with a cancellation timestamp at or after confirmation. Reopening a cancelled booking, clearing its cancellation timestamp, or introducing another lifecycle transition fails closed at the database boundary.

The original rental booking migration already treats allocations belonging to `CANCELLED` bookings as historical rather than active inventory protection. Hold creation, unavailable-date blocks, availability search, competing booking-allocation checks, and unit-mutation guards consider only non-cancelled bookings. Because the cancellation transition uses the same physical-unit serialization boundary, a new hold or block cannot race between lifecycle release and the inventory decision.

Cancellation intentionally does not delete `RentalBookingAllocation`. The allocation remains exact historical evidence of what physical unit and dates were committed before cancellation, while its cancelled parent makes it non-blocking for live inventory.

## Audit and retained evidence

A successful lifecycle transition records `booking.rental.cancelled` with the actor, tenant, booking resource, previous confirmed state, physical unit/date allocation identity, cancellation timestamp, and an explicit `inventoryProtectionReleased` marker. The audit contains no credentials or payment data.

The immutable customer snapshot, source hold, exact money, pricing snapshot/fingerprint, conversion-authority fingerprint, confirmation time, and physical allocation remain retained by the supported application lifecycle. Customer de-identification therefore continues to treat a cancelled rental booking as a booking-reference retention boundary; cancellation is not data erasure.

## Staff UX

The authenticated rental booking detail shows the cancellation action only when all of these are true:

- the booking is still `CONFIRMED`
- its exact allocation is present
- the actor has `booking:manage`
- the actor has `availability:manage`

The action uses an explicit confirmation disclosure before POSTing. Success redirects back to the same booking detail with a lifecycle message. Repeated cancellation reports that the booking was already cancelled. Permission, unavailable, conflict, validation, and server failures return explicit error feedback without presenting success.

Cancelled detail pages retain the original allocation and commercial evidence, show the recorded cancellation timestamp, and explain that the allocation no longer protects live availability.

## Deliberate commercial boundary

Rental cancellation currently releases SF-owned physical inventory only. It does not perform a refund, capture, authorization release, deposit action, or provider call because rental payments/deposits are not implemented. It also does not infer a fee, penalty, refund amount, tax adjustment, customer notification, fulfillment reversal, or external synchronization.

Rescheduling and amendments remain separate contracts because the existing rental booking commercial/date evidence is deliberately immutable. A future date/unit/price change needs explicit replacement or amendment authority, current pricing revalidation, target inventory protection, stale-write behavior, and any payment/deposit semantics together rather than mutating the retained confirmation snapshot in place.

## Validation

`scripts/rental-booking-cancellation-source-contract.test.mjs` protects authorization, tenant scope, shared booking/unit serialization, exact final mutation predicates, database terminal-lifecycle enforcement, route authority, explicit staff confirmation, retained allocation semantics, audit evidence, and the no-fake-financial-workflow boundary.

`src/server/bookings/rental-booking.integration.ts` extends the guarded disposable-PostgreSQL scenario with cross-tenant cancellation denial, successful and idempotent cancellation, database rejection of cancellation reversal, cancelled-list/read evidence, reopened availability, creation of a new overlapping hold after cancellation, and continued booking-reference protection for customer de-identification.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database migration and concurrency execution remain `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
