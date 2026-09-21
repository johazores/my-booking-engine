# Availability

## Status

SF implements normalized hospitality availability reads, persisted room-type availability windows, concurrency-safe temporary holds, hold expiry semantics, permanent booking allocations, and atomic hold-to-booking confirmation. Availability evaluates tenant-owned property, room type, rate plan, stay dates, requested units, active physical rooms, active capacity windows, active unexpired holds, non-cancelled booking allocations, and active rate restrictions.

The core internal hospitality policy is **no overbooking**: sellable capacity is physical/window capacity minus temporary holds and non-cancelled permanent booking allocations on every occupied night. Booking confirmation revalidates current transactional pricing before the hold is consumed and the permanent allocation is committed.

## Normalized request contract

Availability requests use a provider-independent application shape: `propertyId`, `roomTypeId`, `ratePlanId`, arrival date, departure date, and unit quantity. Dates are strict `YYYY-MM-DD` values; departure is exclusive and must follow arrival. Stays are bounded to 365 nights and quantity to 1-50 units.

External providers translate into this normalized contract rather than leaking provider-specific models into internal booking logic.

## Physical capacity and availability windows

Baseline hospitality capacity comes from ACTIVE physical `HospitalityRoom` records in the requested tenant/property/room type. `OUT_OF_SERVICE` and `ARCHIVED` rooms never count as sellable capacity.

Persisted `HospitalityAvailabilityWindow` records can reduce that baseline for an inclusive date range. A window stores tenant/property/room-type scope, start/end dates, a `capacityLimit` from 0-50, lifecycle timestamps, and archival status. Active windows for the same room type may not overlap.

A window can never increase sellable units above active physical inventory. A zero-capacity window closes inventory for its covered nights. Window creation, hold creation, booking confirmation, rescheduling, cancellation, and commercial inventory changes use the established room-type allocation lock where they change or depend on protected inventory. A new window is rejected when its capacity would fall below units protected by active unexpired holds or non-cancelled confirmed booking allocations in the affected date range.

Window writes require `availability:manage`; reads require `availability:read`. Creation verifies the active tenant-owned room type, rejects active overlap, and writes a safe audit event. Archival is tenant-scoped and audited.

## Temporary holds

`HospitalityAvailabilityHold` stores organization/property/room-type/rate-plan scope, stay dates, quantity, bounded expiry, lifecycle status, and an organization-scoped idempotency key. The idempotency key is unique per tenant: an exact retry returns the original hold, while reusing the same key for a different payload is rejected.

Hold duration defaults to 15 minutes and is capped at 30 minutes. String durations are parsed strictly rather than accepting prefixes such as `10minutes`. Hold creation requires `availability:manage`, validates the active room-type/rate-plan assignment and effective restrictions, then acquires a PostgreSQL transaction-scoped advisory lock for the tenant/property/room type before recalculating capacity and writing the hold in a serializable transaction.

Capacity is evaluated per occupied night. For each night SF combines active physical rooms, any capacity window for that night, all active unexpired overlapping holds, and all non-cancelled permanent booking allocations. The normalized availability result exposes the minimum remaining sellable units across the full requested stay plus peak held, allocated, and protected units.

Hold states are `ACTIVE`, `RELEASED`, `EXPIRED`, and `CONSUMED`. Expiry correctness does not depend on a scheduler: reads and new allocations ignore an ACTIVE hold once `expiresAt` has passed. `expireHospitalityAvailabilityHolds` performs a bounded persisted transition to `EXPIRED` for cleanup/audit purposes, and explicit release is idempotent. `CONSUMED` means the hold has been atomically converted into a persisted booking allocation and must never return capacity on its own.

## Permanent booking allocations

`HospitalityBookingAllocation` is the durable occupied-night capacity record for the implemented hospitality booking boundary. It belongs to one organization, booking, property, and room type and stores exclusive-departure stay dates plus quantity.

Hold conversion creates the booking allocation and transitions the hold to `CONSUMED` inside the same serializable transaction under the shared room-type allocation lock. Booking confirmation revalidates current restrictions and the complete transactional price snapshot before committing the booking/allocation transition. There is no commit point where a confirmed booking exists but its former hold has disappeared from protected capacity without a replacement allocation.

Availability reads and new hold creation subtract allocations owned by non-cancelled bookings. Cancellation is a retained `CONFIRMED -> CANCELLED` lifecycle transition: it does not delete the booking or allocation. Once the booking is cancelled, availability stops subtracting that retained allocation, so capacity is released exactly through booking lifecycle state rather than by destroying historical inventory evidence.

Cancellation now verifies that the tenant-owned allocation still matches the booking property, room type, stay dates, and quantity before the lifecycle transition can commit. PostgreSQL then prevents direct rewrites of those allocation inventory fields after cancellation. See [hospitality-cancelled-allocation-history-integrity.md](./hospitality-cancelled-allocation-history-integrity.md).

## No-overbooking rule

For each occupied night:

```text
night capacity = min(active physical rooms, applicable capacity-window limit)
protected units = active unexpired hold units + non-cancelled booking allocation units
sellable units = max(0, night capacity - protected units)
```

The stay-level sellable quantity is the minimum sellable units across all occupied nights. New holds serialize on tenant/property/room-type scope and re-read protected capacity while holding the lock. Hold conversion takes the same lock before it replaces held capacity with permanent allocation. Reschedule and supported commercial inventory changes also revalidate protected capacity under the booking/allocation locking boundaries documented in booking management.

## Effective restrictions

Availability requires an active room type and active rate-plan assignment within the same tenant/property. It reads both property-wide and room-type-specific active restrictions for the requested rate plan.

Restriction evaluation is conservative: the highest applicable minimum stay wins, the lowest applicable maximum stay wins, and any applicable closed-to-arrival/departure rule closes that boundary. Machine-readable reasons include `insufficient-capacity`, `minimum-stay`, `maximum-stay`, `closed-to-arrival`, and `closed-to-departure`.

## Authorization and tenancy

Organization/platform admins and managers have `availability:manage`; staff have `availability:read`; customer-role organization memberships have no internal availability access. Every operation validates UUID inputs, authenticated tenant membership, permission, active parent records, and organization scope server-side.

Booking allocation writes are not exposed through availability permissions. They are owned by booking-management services and require booking authority, which prevents callers from manufacturing permanent capacity records through an availability-management surface.

## Validation coverage

The dependency-free unit/source-contract suites cover normalized request/restriction behavior, availability-window calculations, strict hold validation/idempotency matching, per-night held + permanently allocated capacity calculations, booking/allocation write scope, and source-evidence/terminal-history guards.

The guarded disposable-PostgreSQL suite covers tenant isolation, physical capacity, out-of-service exclusion, effective restrictions, window authorization/overlap/capacity behavior, hold authorization/idempotency/release/expiry/auditing, competing last-unit holds, confirmation/allocation conversion, rescheduling/commercial inventory changes, cancellation release behavior, and direct database integrity regressions.

These PostgreSQL scenarios are checked in but are only claimable when run through the repository's explicitly disposable database path. Full repository validation likewise requires the Node 24 toolchain declared in `package.json`. GitHub Actions are intentionally not used.

## Current boundary

Hospitality availability, confirmation, same-price date rescheduling, supported commercial room/rate/quantity changes, and cancellation are implemented against retained internal inventory evidence. Future availability work should be driven by a concrete product/provider requirement rather than reopening the current normalized first-party contract speculatively.
