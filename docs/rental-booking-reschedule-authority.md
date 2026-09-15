# Rental booking reschedule authority

SF has a server-authoritative preflight for the supported same-unit, price-neutral rental reschedule lifecycle.

`reviewRentalBookingRescheduleAuthority` accepts the authenticated organization, actor, booking ID, and proposed exclusive-end date range. It requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read`; every booking, allocation, inventory, and pricing query remains tenant-scoped.

The target range is normalized as calendar dates and capped at 90 days. The review uses PostgreSQL `clock_timestamp()` and validates the current effective allocation rather than assuming the immutable booking-time dates are still operational after a prior reschedule.

Current target inventory is rejected when it overlaps an unavailable block, an effective active hold, or another non-cancelled booking allocation. The booking's own current allocation is the only allocation excluded.

Current rate periods are rebuilt with the rental pricing engine. Authority is ready only when target currency and exact aggregate minor-unit total remain unchanged. `NO_CHANGE`, `INVENTORY_CONFLICT`, and `PRICE_CHANGED` are explicit blockers.

A ready review receives a version-2 SHA-256 authority fingerprint binding tenant/booking identity, booking `updatedAt`, the physical assignment, effective source dates, proposed target dates, exact unchanged money, the effective source pricing fingerprint, and current target pricing fingerprint.

The review itself reserves nothing. `applyRentalBookingReschedule` later reacquires the tenant/booking and physical-unit locks, rebuilds the same authority, and fails closed if lifecycle, inventory, pricing, ownership, effective source dates, or booking version changed.

The durable design keeps original booking commercial evidence immutable. Successful changes are recorded in append-only `rental_booking_reschedules` rows and only the effective `RentalBookingAllocation` dates move. See [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md).

Physical-unit substitution, price-changing amendments, payment/deposit consequences, cancellation financial policy, and fulfillment changes remain separate contracts.

Repository-wide validation remains `npm run validate` under the Node version declared by `package.json`. Database-backed validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
