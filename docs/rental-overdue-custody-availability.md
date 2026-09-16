# Rental overdue-custody availability protection

A physical rental unit that has been picked up but not returned remains operationally available for later reservations until its committed rental period actually expires. Once the exclusive effective end date is reached in the booking location's IANA timezone and no return evidence exists, SF treats that unit as **overdue open custody** and removes it from new inventory authority until return is recorded.

This is an inventory-integrity rule, not a late-fee or extension workflow. It does not alter booking dates, accepted money, settlement evidence, customer terms, or the append-only pickup/return history.

## Time authority

Overdue status is evaluated from PostgreSQL `clock_timestamp()` and the retained booking location timezone. The effective pickup event already snapshots the post-reschedule dates and post-substitution physical unit, and pickup freezes later date/unit mutations. The exclusive `endsOn` date therefore remains stable custody evidence after handoff.

The application reconciliation helper bounds open-custody evidence to 1,000 rows per scoped decision and fails closed if that safety limit is exceeded. This avoids silently returning incomplete availability when a tenant has an unexpectedly large unresolved custody set.

## Protected decision surfaces

Overdue open custody is excluded or rejected by:

- rental availability search, before count/pagination so totals remain accurate;
- rental hold creation under the physical-unit advisory lock;
- stale hold-to-booking conversion review and final confirmation;
- pre-pickup same-unit reschedule review when another overdue booking still retains the unit;
- pre-pickup same-type/same-location replacement-unit candidate discovery and target review.

The read-only reschedule and substitution surfaces also refuse bookings that already have fulfillment evidence, matching the database rule that those mutations are pre-pickup only.

## Staff operational visibility

Rental booking list and detail reads now derive the same overdue-custody condition for staff instead of leaving the inventory block invisible. Each request obtains one PostgreSQL `clock_timestamp()` observation inside its existing `RepeatableRead` snapshot, uses the immutable pickup event's exclusive `endsOn` date plus the retained booking location timezone, and exposes a read-only overdue flag with the expected-return boundary.

The booking list marks affected rows as **Overdue custody**. Booking detail shows an alert and changes the custody badge to **OVERDUE CUSTODY** while still exposing the real `Record return` action to authorized staff. This visibility does not create a new mutable booking status and does not bypass the existing server/database inventory guards.

## Database safety

The migration adds a tenant-aware `sf_rental_unit_has_overdue_custody` predicate using pickup evidence, absence of return evidence, confirmed booking state, and the booking location timezone. Separate guards reject new/effective holds, allocation writes, and substitution targets that would use a unit with overdue open custody.

Supported hold creation and hold-to-booking confirmation acquire the existing physical-unit advisory lock before their service-level custody recheck. Allocation and substitution database guards acquire the same unit-lock namespace before evaluating overdue custody, so reschedule and replacement final writes also fail closed even if a stale or bypassed application path reaches persistence.

These database guards are defense in depth; they do not replace server authorization, tenant scope, idempotency, or service-level conflict handling.

## Interaction with early return

Return clears open custody through append-only `RETURNED` evidence. Return itself does not shorten the existing allocation, so live inventory remains protected through the committed end until staff explicitly apply early-return inventory release.

When an early-return release is valid, SF keeps the committed custody dates unchanged and shortens only the live allocation end to the first reusable whole rental day after the local return day. That separate append-only contract is documented in [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md).

## Deliberate boundaries

This protection does **not** implement rental extensions, grace periods, late fees, damage charges, security-bond decisions, automatic customer notifications, replacement dispatch, maintenance transitions, or forced cancellation of later bookings. Those require separate commercial rules.

GitHub Actions are not required or used.
