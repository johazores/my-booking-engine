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

## Database safety

The migration adds a tenant-aware `sf_rental_unit_has_overdue_custody` predicate using pickup evidence, absence of return evidence, confirmed booking state, and the booking location timezone. Separate guards reject new/effective holds, allocation writes, and substitution targets that would use a unit with overdue open custody.

Supported hold creation and hold-to-booking confirmation acquire the existing physical-unit advisory lock before their service-level custody recheck. Allocation and substitution database guards acquire the same unit-lock namespace before evaluating overdue custody, so reschedule and replacement final writes also fail closed even if a stale or bypassed application path reaches persistence.

These database guards are defense in depth; they do not replace server authorization, tenant scope, idempotency, or service-level conflict handling.

## Deliberate boundaries

This protection does **not** implement rental extensions, grace periods, late fees, damage charges, security-bond decisions, automatic customer notifications, replacement dispatch, maintenance transitions, or forced cancellation of later bookings. Those require separate commercial rules.

Return clears open custody through append-only `RETURNED` evidence. The existing allocation continues to protect the originally committed period; an early return still does not release inventory before the effective end date.
