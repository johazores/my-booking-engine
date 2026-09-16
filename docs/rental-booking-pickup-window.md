# Rental booking pickup window

SF only permits physical pickup while the confirmed booking's current committed rental period is active in the retained booking location timezone.

The rule is date-based because the rental contract uses `DATE` boundaries: pickup opens on the effective `startsOn` local date and closes when the exclusive effective `endsOn` local date is reached. A supported pre-pickup reschedule changes those effective dates; the original booking-time dates remain immutable evidence.

## Server authority

The fulfillment writer derives the current effective dates from the retained booking plus the latest supported pre-pickup reschedule. It uses PostgreSQL `clock_timestamp()` and the retained `RentalLocation.timeZone`; browser time, application-server timezone, query parameters, and submitted timestamps do not decide pickup eligibility.

Before the start date the write fails closed. At or after the exclusive end date the write also fails closed. Pickup during the active date window continues through the existing `booking:manage` + `inventory:manage`, tenant scope, booking lock, physical-unit lock, exact allocation, active-unit, idempotency, audit, and append-only custody boundaries.

A database trigger independently repeats the tenant booking lock, effective-date derivation, retained-location timezone lookup, PostgreSQL clock authority, and exclusive-window check for direct inserts into fulfillment evidence. A caller cannot backdate or future-date `occurredAt` to bypass the current pickup window.

## Staff experience

Booking detail uses the PostgreSQL custody observation time already returned by the tenant-scoped booking read snapshot. The **Record pickup** action is rendered only while the booking is awaiting pickup and the committed local-date window is open.

Before the window opens, staff see the committed opening date. Once the exclusive committed end date is reached without pickup, staff see that the pickup window is closed instead of a primary action that the server will reject. Existing supported reschedule, settlement/refund, and cancellation rules remain separate and can be used where their own authority allows them.

## Deliberate boundaries

This guard does not automatically extend a rental, create a late fee, convert a missed pickup into a cancellation, change accepted money, issue a refund, or invent a no-show policy. Those are separate commercial decisions. It only prevents physical custody from being handed over outside the retained committed rental window.

Existing pickup evidence remains append-only. Return and overdue-custody behavior are unchanged: a valid pickup that remains open at the exclusive committed end becomes overdue custody until return is recorded.

## Validation

- `src/server/bookings/rental-booking-pickup-window-domain.test.ts` covers start-date opening, pre-start rejection, exclusive-end closure, timezone authority, and invalid date evidence.
- `scripts/rental-booking-pickup-window-source-contract.test.mjs` protects the service, database trigger, staff action, and documentation boundaries.
- Full migration execution remains part of the guarded disposable-PostgreSQL validation path under the Node version declared in `package.json`.

GitHub Actions are not required or used.
