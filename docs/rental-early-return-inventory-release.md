# Rental early-return inventory release

SF supports an explicit staff-only inventory release after a rental has been returned before the committed end date.

Return custody evidence by itself does not shorten inventory protection. Authorized staff must deliberately apply the release, and SF only frees complete rental calendar days after the local return day. The customer-facing committed rental period and accepted commercial evidence remain unchanged.

## Authority

The writer requires both `booking:manage` and `inventory:manage`. Tenant, actor, booking, effective physical unit, committed dates, return event, release date, event time, and idempotency authority are derived server-side.

The browser submits no tenant, actor, unit, date, money, return timestamp, release timestamp, or idempotency fields.

The writer takes the tenant/booking advisory lock followed by the current physical-unit lock and runs in a serializable transaction. It requires:

- a still-confirmed tenant booking;
- the exact effective unit after any supported pre-pickup substitution;
- the exact committed dates after the latest supported date change, including an in-custody same-unit extension when one exists;
- an intact allocation still protecting the full committed period;
- append-only `RETURNED` evidence for that exact unit and effective committed date range; and
- an active physical unit at the retained booking assignment.

The release time comes from PostgreSQL `clock_timestamp()`. The inventory cutoff is derived from the immutable return timestamp in the retained booking location timezone.

## Whole-day release semantics

Rental inventory currently uses PostgreSQL `DATE` ranges with an exclusive end. SF therefore does not make the physical unit reusable during the calendar day on which it was returned.

The new allocation end is the later of:

1. the day after the return event in the retained booking location timezone; or
2. the day after the committed start date.

A release is allowed only when that exclusive end is still earlier than the committed rental end. This guarantees that the allocation remains a valid non-empty range and that only complete remaining rental days are released.

For example, a booking committed for October 10 through October 16 that is returned on October 12 local time may shorten live allocation protection to October 13. October 13 onward is no longer occupied by that booking allocation, but the returned physical unit remains operationally unavailable until its return inspection is retained and authorized inventory staff explicitly restore the unit to `AVAILABLE`.

That separation is intentional: early-return release frees calendar capacity from the old booking; it does not certify physical readiness for a new customer.

## Returned-unit readiness boundary

The supported `RETURNED` workflow moves an otherwise available unit to `OUT_OF_SERVICE` under the same tenant/unit lock, retaining `Returned unit awaiting operational readiness review`. Existing operational outage reasons are preserved.

Pending return inspection is also a database-level fresh-authority blocker. Direct SQL cannot use a returned-but-uninspected unit for a new active hold, booking/allocation, substitution, reschedule, pickup, or operational `AVAILABLE` transition. This means an early-return release cannot bypass the inspection workflow merely because it shortened the allocation first.

After a `CLEAR` inspection, staff still make an explicit operational release decision. Non-clear inspections remain governed by the existing damage and maintenance readiness rules.

## Durable evidence

`RentalBookingEarlyReturnRelease` is append-only tenant-owned evidence. It retains the booking, effective unit, exact return event, committed start/end, shortened allocation end, immutable return timestamp, server-derived idempotency key, and PostgreSQL release timestamp.

The database insert guard repeats the booking/unit lock boundary, derives committed dates from the latest tenant-owned reschedule/extension evidence, and requires exact return custody evidence plus the still-full committed allocation. The allocation guard then allows only the shortened end recorded by that release evidence. A deferred constraint requires the evidence and shortened allocation to commit together.

Repeated requests replay an existing release only after re-deriving the retained confirmed booking's effective unit and latest committed dates, reacquiring the effective-unit lock, matching the exact linked `RETURNED` event and immutable return timestamp, and verifying that the live allocation still ends at the retained released date. An idempotency key match by itself is not sufficient.

## Commercial boundary

Early-return inventory release does not refund, reprice, shorten the customer's committed rental period, or create an inspection outcome. It does not decide damage, deposits/security bonds, late fees, maintenance state, delivery, notifications, or external provider synchronization.

Payment and refund evidence remains governed by the separate rental payment contract. Any future commercial early-return adjustment must be a separate explicit amendment workflow rather than an implicit side effect of freeing physical stock.

## Staff UX

The booking detail distinguishes:

- **Committed rental period** — retained customer/commercial dates after the latest supported reschedule or custody extension.
- **Live inventory protection** — the current allocation date range used by booking-overlap decisions.

After `RETURNED`, when at least one complete future rental day can be freed and no release exists, authorized staff see `Release remaining inventory`. Once applied, append-only release evidence is displayed and the action disappears. The physical unit still remains out of service until inspection and explicit operational release complete, so the shortened allocation is not presented as proof that the unit is immediately sellable.

The booking list continues to show the committed rental period while separately identifying an early-return inventory release. Post-pickup replacement-unit actions are not shown.

## Validation

- `src/server/bookings/rental-booking-early-return-release-domain.test.ts` covers location-calendar release dates, whole-day semantics, no-op rejection, and deterministic idempotency.
- `scripts/rental-early-return-inventory-release-source-contract.test.mjs` protects tenant ownership, append-only persistence, booking/unit serialization, latest reschedule/extension date derivation, replay revalidation, exact return-event authority, server-derived route authority, exact allocation shortening, database guards, and staff read/UI semantics.
- `scripts/rental-return-readiness-source-contract.test.mjs` protects the additional rule that released calendar capacity cannot make a returned physical unit sellable before inspection and explicit operational readiness release.
- Full Prisma, migration, PostgreSQL, typecheck, lint, test, and build validation remains part of the repository-supported Node 24 workflow and guarded disposable-database tests.

GitHub Actions are not required or used.
