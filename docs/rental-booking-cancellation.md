# Rental booking cancellation

SF implements a staff-only rental booking cancellation lifecycle for the durable confirmed rental booking contract. Cancellation is an inventory-release state transition, not deletion and not a financial workflow. It changes one tenant-owned `CONFIRMED` rental booking to `CANCELLED`, records database cancellation time and audit evidence, retains immutable booking/customer evidence plus append-only reschedule history and the current physical allocation as historical evidence, and releases that effective physical-unit/date commitment from live availability.

## Authority and tenant scope

`cancelRentalBooking` is server-only. It validates organization, actor, and booking UUIDs and independently requires:

- `booking:manage`, because the operation changes durable booking lifecycle
- `availability:manage`, because cancellation releases protected physical inventory

The staff route derives organization and actor from authenticated server context. The browser cannot choose tenant, actor, unit, dates, customer, price, cancellation time, or inventory-release authority.

Every booking and reschedule read repeats authenticated `organizationId`. A booking ID from another tenant resolves as unavailable rather than becoming cross-tenant mutation authority.

## Serialization and effective allocation

Cancellation runs in a serializable transaction. It acquires the shared tenant-and-booking advisory lock and then the tenant-and-physical-unit advisory lock used by rental inventory/reschedule workflows.

After both locks are held, the service uses PostgreSQL `clock_timestamp()`, re-reads the tenant booking/allocation, and reads the latest append-only reschedule. The effective source dates are the latest reschedule target when one exists; otherwise they are the original booking dates.

Cancellation fails closed when the allocation is missing or does not match organization, booking, unit, and those effective dates.

The final `CONFIRMED -> CANCELLED` mutation remains an exact compare-and-swap over the tenant, lifecycle, prior null cancellation time, observed `updatedAt`, customer snapshot identity, source hold, unit/type/location, confirmation idempotency key, original immutable booking dates, currency, exact total, original pricing fingerprint/observation, conversion-authority fingerprint, and confirmation time. Rescheduling advances `updatedAt`, so stale cancellation decisions also fail closed.

Serializable write conflicts are retried a bounded number of times. A retry after successful cancellation is idempotent and does not create duplicate audit evidence.

## Database lifecycle protection

The cancellation migration permits only `CONFIRMED` with no cancellation timestamp to transition to `CANCELLED` with a timestamp at or after confirmation. Reopening or clearing cancellation fails closed.

The rental inventory guards treat allocations belonging to cancelled bookings as historical rather than live protection. Because cancellation uses the same physical-unit serialization boundary as availability and rescheduling, no new inventory decision can race between lifecycle release and commit.

Cancellation intentionally does not delete `RentalBookingAllocation` or `RentalBookingReschedule` rows.

## Audit and retained evidence

A successful transition records `booking.rental.cancelled` with actor, tenant, booking, prior state, current effective physical-unit/date allocation, latest reschedule reference when present, cancellation timestamp, and `inventoryProtectionReleased: true`.

Immutable customer snapshot, source hold, accepted money, original pricing/conversion evidence, append-only reschedule evidence, confirmation time, and physical allocation remain retained. Customer de-identification continues to treat a cancelled rental booking as a retention boundary.

## Staff UX

Cancellation is shown only when the booking is still `CONFIRMED`, its current allocation exists, and the actor has `booking:manage` plus `availability:manage`.

The action uses explicit confirmation. Success returns to the booking detail; repeated cancellation reports the existing terminal state. Permission, unavailable, conflict, validation, and server failures have explicit feedback.

Cancelled details preserve original booking-time evidence, reschedule history, current effective allocation, and cancellation timestamp while explaining that live inventory protection has ended.

## Deliberate commercial boundary

Rental cancellation releases SF-owned physical inventory only. It does not perform refund, capture, authorization release, deposit action, provider call, fee/penalty calculation, tax adjustment, customer notification, fulfillment reversal, or external synchronization.

Same-unit, price-neutral date rescheduling is implemented separately in [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md). Physical-unit substitution, price-changing amendments/rescheduling, and any payment/deposit consequences remain separate commercial contracts.

## Validation

`scripts/rental-booking-cancellation-source-contract.test.mjs` protects authorization, tenant scope, shared booking/unit serialization, current effective allocation handling, exact final mutation predicates, terminal database lifecycle enforcement, route authority, staff confirmation, retained evidence, and the no-fake-financial-workflow boundary.

`src/server/bookings/rental-booking.integration.ts` contains the guarded disposable-PostgreSQL cancellation scenario. Full database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. GitHub Actions are not required or used.
