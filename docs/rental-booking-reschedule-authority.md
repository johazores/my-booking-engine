# Rental booking reschedule authority

SF now has a server-only, read-only preflight for a narrow rental date-reschedule contract. It reviews whether one existing confirmed rental booking could move to a different date range on the **same physical unit** without changing the accepted aggregate price. The review does not mutate the booking, allocation, hold state, payment state, or inventory. It exists to establish fresh server authority before a later durable reschedule writer is designed.

## Scope

`reviewRentalBookingRescheduleAuthority` accepts the authenticated organization, actor, existing rental booking ID, and a proposed exclusive-end date range. It requires `booking:manage`, `availability:read`, `inventory:read`, and `pricing:read` before any booking authority is returned.

The review is intentionally limited to the already-booked physical unit. Unit substitution, location changes, price-changing amendments, payment/deposit adjustments, cancellation fees, and fulfillment changes remain separate commercial contracts.

The target range is normalized as calendar dates and capped at 90 days so the review uses the same bounded pricing horizon as rental availability pricing.

## Tenant and booking integrity

The service resolves the source booking only by `id + organizationId` and requires it to remain `CONFIRMED` with no cancellation timestamp. The exact retained allocation must still match the booking tenant, booking ID, physical unit, start date, and end date.

The retained unit, unit type, and operating location must still be active and must still match the booking's immutable unit/type/location evidence. A cross-tenant booking identifier or stale physical assignment never becomes reschedule authority.

## Target inventory revalidation

The review uses PostgreSQL `clock_timestamp()` inside a serializable transaction. Against the proposed dates it checks the source booking's physical unit for:

- unavailable-date blocks;
- effective active holds using database time;
- another non-cancelled rental booking allocation.

The current booking's own allocation is the only allocation excluded from the overlap query. This is important for legitimate date shifts that overlap part of the original range while still rejecting every other live inventory commitment.

The preflight itself acquires no write lock and reserves no inventory. A future writer must therefore reacquire the shared physical-unit serialization boundary and repeat these checks immediately before any durable transition.

## Price-neutral boundary

Current rate periods are rebuilt for the target dates with the existing rental pricing engine. A review is only ready when target currency and exact aggregate minor-unit total are unchanged from the accepted booking.

A changed aggregate amount returns `PRICE_CHANGED`. SF does not silently create a debit, refund, credit, deposit change, tax adjustment, or payment-provider action. Different daily-rate segments may produce a different target pricing fingerprint while still producing the same aggregate total; that target fingerprint is retained in the authority evidence for a future writer.

`NO_CHANGE` is returned when the requested dates are identical to the current booking. `INVENTORY_CONFLICT` is returned when blocks, effective holds, or another live booking allocation occupy the target range.

## Authority fingerprint

A ready review receives a deterministic SHA-256 authority fingerprint binding:

- tenant and booking identity;
- the observed booking `updatedAt` version;
- physical unit, unit type, and operating location;
- proposed target dates;
- currency and exact unchanged total;
- source accepted pricing fingerprint;
- newly calculated target pricing fingerprint.

This fingerprint is evidence for a future write boundary, not write permission by itself. A future writer must rebuild and compare it under the booking and physical-unit locks and must fail closed if booking state, inventory, pricing, or ownership changed.

## Deliberate persistence boundary

The current rental booking migration makes accepted ownership, date, unit, and pricing evidence immutable. The preflight therefore does not update `RentalBooking` or `RentalBookingAllocation` and does not weaken the database trigger.

A production reschedule writer requires an explicit persistence design that preserves the original accepted snapshot while durably recording replacement/amendment evidence, serializes source and target inventory, defines idempotent replay/stale-authority behavior, and remains price/payment safe. That is the next distinct lifecycle boundary; it is not faked by this review.

## Validation

`src/server/bookings/rental-booking-reschedule-domain.test.ts` covers the bounded date contract and deterministic authority fingerprint. `scripts/rental-booking-reschedule-authority-source-contract.test.mjs` protects permissions, tenant scope, allocation integrity, exclusion of only the source allocation, current inventory/pricing revalidation, fingerprint inputs, the read-only boundary, and continued database immutability.

Repository-wide validation remains `npm run validate` under the Node version declared by `package.json`. Database-backed concurrency validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
