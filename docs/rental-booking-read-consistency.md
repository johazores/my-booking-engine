# Rental booking read consistency

SF rental booking staff reads use a bounded, tenant-scoped snapshot contract. Booking detail and paginated booking history are operational views of append-only commercial and custody evidence, so they must not combine rows observed before and after a concurrent lifecycle write.

## Snapshot boundary

`getRentalBooking` runs the retained booking row, reschedule history, physical-unit substitution history, and fulfillment history inside one PostgreSQL `RepeatableRead` transaction after `booking:read` authorization and UUID validation. Every resource query repeats both `organizationId` and `bookingId` where applicable.

`listRentalBookings` runs its count and page query in the same `RepeatableRead` snapshot. This prevents the staff page from reporting a total/page calculation from one database state while rendering rows from another concurrent state.

The read transaction does not create write authority. Confirmation, cancellation, reschedule, substitution, settlement, pickup/return, and early-return release continue to revalidate their own server authority inside their existing serializable write boundaries.

## Bounded append-only history

Booking detail needs complete reschedule and physical-unit substitution history to render retained evidence accurately. Those collections are therefore loaded through `readBoundedRentalBookingHistory` using 100-row cursor pages with tenant and booking scope repeated on every query.

The current safety limit is 1,000 rows per history collection. An exact 1,000-row history is accepted after a one-row overflow probe proves completeness. Evidence beyond the limit fails closed instead of silently truncating history or deriving a current assignment from incomplete evidence.

Cursor traversal orders by the immutable row ID only so pagination has a stable unique cursor. After the complete bounded set is loaded, rows are sorted for presentation and domain use by `appliedAt`, then `createdAt`, then `id`, preserving the existing chronological contract.

Fulfillment evidence is structurally limited to one pickup and one return. Read models request at most three rows: two valid events fit completely, while any third row is still visible to `deriveRentalBookingFulfillmentState` and causes the existing integrity checks to fail rather than hiding duplicate custody evidence.

## Failure behavior

A missing tenant-owned booking remains `RentalBookingUnavailableError`. A reschedule or substitution history that cannot be proven complete within the safety boundary raises `RentalBookingHistoryUnavailableError`. This is an integrity/operational failure, not a partial-success response.

No customer, payment, provider, delivery, inspection, damage, fee, or maintenance semantics are introduced by this read hardening.

## Validation

- `src/server/bookings/rental-booking-history.test.ts` covers multi-page completion, exact-limit completion, overflow failure, and page-bound violations.
- `scripts/rental-booking-read-consistency-source-contract.test.mjs` protects tenant-scoped cursor pagination, bounded fulfillment reads, and `RepeatableRead` snapshot use for detail and list queries.
- Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`; PostgreSQL execution remains `npm run test:database` against an explicitly disposable database.

GitHub Actions are not required or used.
