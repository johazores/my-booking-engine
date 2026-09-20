# Rental booking source-evidence integrity

A consumed rental availability hold becomes retained confirmation evidence when it is converted into a durable `RentalBooking`. The booking keeps immutable customer, physical-unit, date, money, pricing, and conversion-authority evidence; the source hold must therefore remain consistent with that accepted state instead of becoming mutable historical input after confirmation.

## Idempotent confirmation replay

`confirmRentalBookingFromHold` still supports exact idempotent replay after later supported booking lifecycle changes. Replay does not require the live allocation to remain at the original unit or dates because rescheduling, unit substitution, and early-return release may legitimately change live inventory protection while retaining the original booking evidence.

Replay now revalidates the retained source hold before returning success. The hold must remain tenant-owned, `CONSUMED`, ended, and complete; its original physical unit, dates, currency, exact amount, pricing fingerprint, and pricing snapshot must match the immutable booking-time evidence. The service also rebuilds the original conversion-authority fingerprint using the retained hold expiry and immutable booking identity. A mismatch fails closed as an integrity error rather than treating the idempotency key alone as authority.

## Database authority

PostgreSQL adds complementary guards:

- a new booking insert must persist the same JSON pricing snapshot retained by its source hold, not only the same currency, total, and fingerprint;
- booking row identity (`id` and `createdAt`) is immutable after creation, so durable booking/audit references and confirmation chronology cannot be rewritten independently of the retained commercial evidence;
- once a hold is referenced by a rental booking, its source identity, unit, dates, lifecycle/expiry evidence, idempotency key, pricing evidence, and creation evidence cannot be rewritten, and the hold cannot be deleted;
- a hold cannot commit in `CONSUMED` state unless the same tenant transaction also leaves a durable rental booking referencing that exact hold;
- a confirmed booking cannot commit without one physical allocation, and a migration-time preflight rejects any already-confirmed booking whose allocation evidence is missing;
- allocation ownership (`organizationId` and `bookingId`) is immutable after creation, so a live allocation cannot be re-parented to fabricate another booking's inventory authority;
- allocation row identity (`id` and `createdAt`) is immutable after creation, so durable allocation/audit references and creation chronology cannot be rewritten independently of the booking;
- every retained rental booking, including a terminal `CANCELLED` booking, must retain its physical allocation as historical evidence.

The booking identity guard complements the original commercial/ownership immutability trigger. Lifecycle fields such as `status`, `cancelledAt`, and Prisma-managed `updatedAt` retain their supported mutation paths, while the durable booking primary key and creation timestamp can no longer be rewritten by direct database updates.

The consumption guard is a deferred PostgreSQL constraint trigger because the production confirmation writer intentionally changes the hold to `CONSUMED` immediately before inserting the booking in the same serializable transaction. The guard checks final committed state rather than the transient order inside that transaction. It also runs a migration-time preflight so an already-orphaned `CONSUMED` hold cannot silently become accepted historical state.

Allocation retention is also deferred. The first ownership hardening protected confirmed bookings; the terminal-retention migration strengthens that boundary so an allocation cannot be deleted while **any** tenant rental booking still owns it. This is required because cancellation releases live availability without deleting historical allocation evidence, and the cancellation audit retains that allocation ID. The stronger migration preflights all existing rental bookings so a previously orphaned cancelled booking cannot silently become accepted history.

The deferred check still permits coherent test/administrative teardown when the allocation and its parent booking are both removed in the same transaction. Allocation ownership and fixed row identity remain immutable. The allocation's current unit/date fields remain intentionally mutable only through the existing guarded reschedule, unit-substitution, and early-return workflows while their lifecycle authority is valid. Those update guards require a live confirmed booking; a cancelled booking cannot rewrite allocation unit or date evidence after cancellation.

Unbooked `ACTIVE`, `RELEASED`, and `EXPIRED` holds retain their existing lifecycle behavior. Pricing evidence was already immutable from hold creation; these additional guards freeze the remaining source evidence only after the hold becomes part of accepted booking history and prevent direct database writes from fabricating consumed inventory evidence, rewriting booking/allocation identity evidence, or deleting the allocation evidence retained by that booking.

## Scope

This hardening does not add deposits, online checkout, late fees, delivery, inspection, maintenance, or customer self-service. It does not change valid reschedule, substitution, cancellation, pickup/return, or early-return release behavior. It strengthens the evidence boundary of the existing hold-to-booking workflow and keeps the physical allocation durable after cancellation even though that terminal allocation no longer blocks live availability.

## Validation

`scripts/rental-booking-source-evidence-integrity-source-contract.test.mjs` protects replay revalidation, exact source pricing-snapshot persistence, immutable booking row identity/creation evidence, post-confirmation source-hold immutability, deferred consumed-hold ownership, the production consume-then-book transaction order, and registration of `src/server/bookings/rental-booking-source-evidence.integration.ts` in the guarded database suite. `scripts/rental-booking-allocation-ownership-integrity-source-contract.test.mjs` protects confirmed-allocation preflight, immutable allocation ownership and row identity, status-independent deferred allocation retention, migration-time terminal-history preflight, and the guarded direct-write regression scenario. The database integration covers direct booking identity/creation-time mutation rejection, direct source-hold mutation rejection, orphan `CONSUMED` transition rejection, valid application confirmation, mismatched booking pricing-snapshot rejection inside one transaction, allocation owner/identity rewrite rejection, confirmed-allocation deletion rejection, and allocation unit/date/delete mutation rejection after supported cancellation.

Database execution still requires the repository's explicitly disposable PostgreSQL path before the open Phase 1 database gates can be claimed. Full repository validation requires the Node version declared in `package.json`. GitHub Actions are not used.
