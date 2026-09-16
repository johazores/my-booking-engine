# Rental booking pickup window

SF only permits physical pickup while the confirmed booking's current committed rental period is active in the retained booking location timezone.

The rule is date-based because the rental contract uses `DATE` boundaries: pickup opens on the effective `startsOn` local date and closes when the exclusive effective `endsOn` local date is reached. A supported pre-pickup reschedule changes those effective dates; the original booking-time dates remain immutable evidence.

## Server authority

The fulfillment writer derives the current effective dates from the retained booking plus the latest supported pre-pickup reschedule. It uses PostgreSQL `clock_timestamp()` and the retained `RentalLocation.timeZone`; browser time, application-server timezone, query parameters, and submitted timestamps do not decide pickup eligibility.

Before the start date the write fails closed. At or after the exclusive end date the write also fails closed. Pickup during the active date window continues through the existing `booking:manage` + `inventory:manage`, tenant scope, booking lock, physical-unit lock, exact allocation, active-unit, idempotency, audit, and append-only custody boundaries.

A database trigger independently repeats the tenant booking lock, effective-date derivation, retained-location timezone lookup, PostgreSQL clock authority, and exclusive-window check for direct inserts into fulfillment evidence. A caller cannot backdate or future-date `occurredAt` to bypass the current pickup window.

The same exclusive end is now also the physical-unit substitution cutoff. Candidate search and fresh substitution review derive the effective dates from retained booking/reschedule evidence, use PostgreSQL time plus the retained location timezone, and refuse replacement review once the pickup window is closed. A separate substitution insert trigger repeats the tenant booking lock, retained location lookup, latest-reschedule date authority, and `clock_timestamp()` boundary so stale pre-boundary review authority cannot be applied after the rental has become a missed pickup.

## Staff experience

Booking detail uses the PostgreSQL custody observation time already returned by the tenant-scoped booking read snapshot. The **Record pickup** action is rendered only while the booking is awaiting pickup and the committed local-date window is open.

Before the window opens, staff see the committed opening date. Once the exclusive committed end date is reached without pickup, staff see a **Missed pickup** state instead of a primary pickup action that the server will reject. Physical-unit replacement is also removed at that boundary. Existing supported reschedule, settlement/refund, and cancellation rules remain separate and can be used where their own authority allows them.

The paginated booking list derives the same closed-window condition as a read-only **Missed pickup** operational state. Its tenant-wide count and optional `MISSED_PICKUP` queue are selected in PostgreSQL before pagination using one database observation time, the retained booking-location timezone, the latest supported reschedule end date, `CONFIRMED` booking state, and the absence of any fulfillment event. Booking, location, reschedule, and fulfillment predicates repeat `organizationId`, and the final page rows are re-read with tenant scope and re-derived through the pickup-window domain. A missing row or SQL/domain disagreement fails closed.

The missed-pickup queue does not create a second mutable booking status. It exists so staff can find expired handoff commitments that can no longer be picked up or reassigned to another physical unit under the current period.

## Deliberate boundaries

This guard does not automatically extend a rental, create a late fee, convert a missed pickup into a cancellation, change accepted money, issue a refund, or invent a no-show policy. Those are separate commercial decisions. It only prevents physical custody and physical-unit reassignment from continuing under an expired retained rental window and surfaces the resulting missed-pickup condition for staff review.

Existing pickup evidence remains append-only. Return and overdue-custody behavior are unchanged: a valid pickup that remains open at the exclusive committed end becomes overdue custody until return is recorded.

## Validation

- `src/server/bookings/rental-booking-pickup-window-domain.test.ts` covers start-date opening, pre-start rejection, exclusive-end closure, timezone authority, and invalid date evidence.
- `src/server/bookings/rental-booking-pickup-read-domain.test.ts` covers read-only missed-pickup derivation for confirmed awaiting-pickup bookings without misclassifying pre-start, picked-up, returned, or cancelled records.
- `scripts/rental-booking-pickup-window-source-contract.test.mjs` protects the pickup-window service, database guard, staff action, and documentation boundaries.
- `scripts/rental-missed-pickup-queue-source-contract.test.mjs` protects tenant-scoped missed-pickup count/page selection, current effective end-date authority, pre-pagination queueing, final domain revalidation, staff filtering, and no-automatic-commerce boundaries.
- `scripts/rental-unit-substitution-pickup-window-source-contract.test.mjs` protects server review, PostgreSQL direct-write protection, and staff removal of replacement actions after the window closes.
- Full migration execution remains part of the guarded disposable-PostgreSQL validation path under the Node version declared in `package.json`.

GitHub Actions are not required or used.
