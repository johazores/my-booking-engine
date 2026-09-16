# Rental booking read consistency

SF rental booking staff reads use a bounded, tenant-scoped snapshot contract. Booking detail and paginated booking history are operational views of append-only commercial and custody evidence, so they must not combine rows observed before and after a concurrent lifecycle write.

## Snapshot boundary

`getRentalBooking` runs the retained booking row, reschedule history, physical-unit substitution history, fulfillment history, and one PostgreSQL custody observation time inside one PostgreSQL `RepeatableRead` transaction after `booking:read` authorization and UUID validation. Every resource query repeats both `organizationId` and `bookingId` where applicable.

`listRentalBookings` obtains one PostgreSQL observation time and keeps its ordinary booking count/page reads, overdue-custody count, optional overdue queue page-ID query, and final page rows inside the same `RepeatableRead` transaction. This prevents the staff page from reporting totals or operational custody from one database state while rendering rows from another concurrent state, and every booking row on the page receives the same database-time reference for overdue-custody display.

The read transaction does not create write authority. Confirmation, cancellation, reschedule, substitution, settlement, pickup/return, and early-return release continue to revalidate their own server authority inside their existing serializable write boundaries.

## Bounded append-only history

Booking detail needs complete reschedule and physical-unit substitution history to render retained evidence accurately. Those collections are therefore loaded through `readBoundedRentalBookingHistory` using 100-row cursor pages with tenant and booking scope repeated on every query.

The current safety limit is 1,000 rows per history collection. An exact 1,000-row history is accepted after a one-row overflow probe proves completeness. Evidence beyond the limit fails closed instead of silently truncating history or deriving a current assignment from incomplete evidence.

Cursor traversal orders by the immutable row ID only so pagination has a stable unique cursor. After the complete bounded set is loaded, rows are sorted for presentation and domain use by `appliedAt`, then `createdAt`, then `id`, preserving the existing chronological contract.

Fulfillment evidence is structurally limited to one pickup and one return. Read models request at most three rows: two valid events fit completely, while any third row is still visible to `deriveRentalBookingFulfillmentState` and causes the existing integrity checks to fail rather than hiding duplicate custody evidence. List projections include the immutable pickup `endsOn` snapshot because overdue-custody display derives from that retained custody evidence rather than mutable booking dates.

## Operational custody status and queue

`deriveRentalBookingCustodyReadState` is read-only. It marks a booking overdue only when the retained booking is still `CONFIRMED`, fulfillment is `PICKED_UP`, and the PostgreSQL observation date in the retained booking location timezone has reached the pickup event's exclusive `endsOn` date. Awaiting-pickup and returned records are never presented as overdue open custody. Cancelled records are expected to have no custody handoff evidence; a cancelled booking carrying pickup/return evidence fails closed as an integrity incident instead of being presented as safely non-overdue.

The staff list exposes the same condition as an `OVERDUE` custody filter. Because operational queues must paginate correctly, `listRentalBookings` computes the tenant overdue count and overdue booking IDs in PostgreSQL before final page loading. The SQL repeats tenant scope on booking, retained location, pickup evidence, and the no-return subquery, orders by the same booking list keys, and receives the already captured PostgreSQL observation timestamp as its time authority. The final Prisma page read repeats `organizationId` plus the selected IDs. SF then requires every selected ID to be re-read and re-derives custody from retained fulfillment evidence; a missing row or SQL/domain disagreement fails closed rather than returning an incomplete or falsely overdue page.

An overdue queue is inherently confirmed custody; combining `CANCELLED` status with `OVERDUE` therefore returns no matching rows rather than weakening either predicate. The list still returns the tenant-wide overdue count as an operational indicator.

The resulting flag and queue do not mutate booking status, extend the rental, calculate a late fee, or replace the database/service availability guards.

## Failure behavior

A missing tenant-owned booking remains `RentalBookingUnavailableError`. A reschedule or substitution history that cannot be proven complete within the safety boundary raises `RentalBookingHistoryUnavailableError`. Missing/invalid PostgreSQL observation time, invalid database queue counts, invalid queue pagination bounds, and inconsistent picked-up custody evidence also fail closed rather than returning a misleading non-overdue state.

No customer, payment, provider, delivery, inspection, damage, fee, or maintenance semantics are introduced by this read hardening.

## Validation

- `src/server/bookings/rental-booking-history.test.ts` covers multi-page completion, exact-limit completion, overflow failure, and page-bound violations.
- `src/server/bookings/rental-booking-custody-read-domain.test.ts` covers overdue staff-read derivation and fail-closed custody evidence.
- `scripts/rental-booking-read-consistency-source-contract.test.mjs` protects tenant-scoped cursor pagination, bounded fulfillment reads, and `RepeatableRead` snapshot use for detail and list queries.
- `scripts/rental-overdue-custody-source-contract.test.mjs` protects PostgreSQL-time custody read derivation and staff list/detail visibility.
- `scripts/rental-overdue-custody-queue-source-contract.test.mjs` protects tenant-scoped overdue count/page SQL, pre-pagination queue selection, snapshot ordering, final tenant-scoped row reads, staff filtering, and deliberate no-fee/no-extension boundaries.
- Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`; PostgreSQL execution remains `npm run test:database` against an explicitly disposable database.

GitHub Actions are not required or used.
