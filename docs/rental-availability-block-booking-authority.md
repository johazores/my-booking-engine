# Rental availability-block booking authority

A staff-created unavailable-date block must not silently overlap a retained non-cancelled rental booking allocation for the same physical unit. A block is operational inventory configuration; it is not authority to invalidate an accepted customer booking.

## Supported write authority

`createRentalAvailabilityBlock` requires `inventory:manage`, normalizes and tenant-scopes the requested physical unit and dates, acquires the shared physical-unit lock, and samples PostgreSQL wall-clock time for active-hold authority. While that lock is held, the service now evaluates the complete same-scope conflict set before creating the block:

- the physical unit must still be active in the tenant;
- another unavailable-date block must not overlap the requested range;
- a still-active, unexpired availability hold must not overlap the requested range; and
- a tenant-owned non-cancelled booking allocation must not overlap the requested range.

The booking check uses the same half-open date semantics as rental availability: `startsOn < requested.endsOn` and `endsOn > requested.startsOn`. A matching booking is returned as `RentalInventoryConflictError`, so the supported inventory route gives normal conflict feedback rather than depending on an opaque database-trigger failure.

This does not treat overdue custody as a reason to reject a block. Staff may legitimately add future unavailable time while a returned-late unit is being recovered; custody availability remains independently protected by its own live authority.

## PostgreSQL backstop

`sf_guard_rental_block_against_holds` remains the independent direct-write authority. It acquires the same shared physical-unit lock and rejects both live hold overlap and non-cancelled booking-allocation overlap before an unavailable-date block can be persisted.

Because accepted booking/allocation writers also serialize through physical-unit authority, the supported application check and PostgreSQL backstop cannot pass each other between conflict evaluation and write. PostgreSQL remains defense in depth for direct SQL and unsupported callers.

## Boundaries

This change does not cancel, reschedule, substitute, reprice, or otherwise mutate an existing booking. It does not automatically create maintenance or operational-state evidence. Staff must resolve the booking through its real booking-management workflow before blocking dates that overlap its retained allocation.

## Validation

`scripts/rental-availability-block-booking-authority-source-contract.test.mjs` protects shared-lock ordering, tenant/unit/date scope, non-cancelled booking semantics, domain conflict handling, and the matching PostgreSQL guard.

Live PostgreSQL concurrency testing still requires an explicitly disposable PostgreSQL target. Full repository validation still requires the project-supported Node 24 toolchain and installed dependencies.

GitHub Actions are not required or used.
