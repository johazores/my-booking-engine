# Rental booking source-evidence integrity

A consumed rental availability hold becomes retained confirmation evidence when it is converted into a durable `RentalBooking`. The booking keeps immutable customer, physical-unit, date, money, pricing, and conversion-authority evidence; the source hold must therefore remain consistent with that accepted state instead of becoming mutable historical input after confirmation.

## Idempotent confirmation replay

`confirmRentalBookingFromHold` still supports exact idempotent replay after later supported booking lifecycle changes. Replay does not require the live allocation to remain at the original unit or dates because rescheduling, unit substitution, and early-return release may legitimately change live inventory protection while retaining the original booking evidence.

Replay now revalidates the retained source hold before returning success. The hold must remain tenant-owned, `CONSUMED`, ended, and complete; its original physical unit, dates, currency, exact amount, pricing fingerprint, and pricing snapshot must match the immutable booking-time evidence. The service also rebuilds the original conversion-authority fingerprint using the retained hold expiry and immutable booking identity. A mismatch fails closed as an integrity error rather than treating the idempotency key alone as authority.

## Database authority

PostgreSQL adds complementary guards:

- a new booking insert must persist the same JSON pricing snapshot retained by its source hold, not only the same currency, total, and fingerprint;
- once a hold is referenced by a rental booking, its source identity, unit, dates, lifecycle/expiry evidence, idempotency key, pricing evidence, and creation evidence cannot be rewritten, and the hold cannot be deleted;
- a hold cannot commit in `CONSUMED` state unless the same tenant transaction also leaves a durable rental booking referencing that exact hold;
- a confirmed booking cannot commit without one physical allocation, and a migration-time preflight rejects any already-confirmed booking whose allocation evidence is missing;
- allocation ownership (`organizationId` and `bookingId`) is immutable after creation, so a live allocation cannot be re-parented to fabricate another booking's inventory authority;
- deleting the allocation of a still-confirmed booking is rejected by a deferred constraint trigger at transaction commit.

The consumption guard is a deferred PostgreSQL constraint trigger because the production confirmation writer intentionally changes the hold to `CONSUMED` immediately before inserting the booking in the same serializable transaction. The guard checks final committed state rather than the transient order inside that transaction. It also runs a migration-time preflight so an already-orphaned `CONSUMED` hold cannot silently become accepted historical state.

The allocation-retention guard is also deferred. This keeps teardown or administrative transaction ordering coherent when the parent booking itself is removed in the same transaction, while a standalone delete cannot silently release inventory from a still-confirmed commercial booking. Allocation ownership is immutable, but the allocation's current unit/date fields remain intentionally mutable only through the existing guarded reschedule, unit-substitution, and early-return workflows.

Unbooked `ACTIVE`, `RELEASED`, and `EXPIRED` holds retain their existing lifecycle behavior. Pricing evidence was already immutable from hold creation; these additional guards freeze the remaining source evidence only after the hold becomes part of accepted booking history and prevent direct database writes from fabricating consumed inventory evidence without its booking owner.

## Scope

This hardening does not add deposits, online checkout, late fees, delivery, inspection, maintenance, or customer self-service. It does not change valid reschedule, substitution, cancellation, pickup/return, or early-return release behavior. It only strengthens the evidence boundary of the existing hold-to-booking workflow and the active physical allocation owned by a confirmed booking.

## Validation

`scripts/rental-booking-source-evidence-integrity-source-contract.test.mjs` protects replay revalidation, exact source pricing-snapshot persistence, post-confirmation source-hold immutability, deferred consumed-hold ownership, the production consume-then-book transaction order, and registration of `src/server/bookings/rental-booking-source-evidence.integration.ts` in the guarded database suite. `scripts/rental-booking-allocation-ownership-integrity-source-contract.test.mjs` protects confirmed-allocation preflight, immutable allocation ownership, deferred active-allocation retention, and the guarded direct-write regression scenario. The database integration covers direct source-hold mutation rejection, orphan `CONSUMED` transition rejection, valid application confirmation, mismatched booking pricing-snapshot rejection inside one transaction, allocation owner-rewrite rejection, and confirmed-allocation deletion rejection.

Database execution still requires the repository's explicitly disposable PostgreSQL path before the open Phase 1 database gates can be claimed. Full repository validation requires the Node version declared in `package.json`. GitHub Actions are not used.
