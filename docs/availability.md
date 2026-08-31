# Availability

## Status

SF implements normalized hospitality availability reads, persisted room-type availability windows, and concurrency-safe temporary holds with automatic expiry semantics. Availability evaluates tenant-owned property, room type, rate plan, stay dates, requested units, active physical rooms, active capacity windows, active unexpired holds, and active rate restrictions. Permanent booking allocations and atomic booking confirmation remain incomplete dependencies and are not represented as finished.

## Normalized request contract

Availability requests use a provider-independent application shape: `propertyId`, `roomTypeId`, `ratePlanId`, arrival date, departure date, and unit quantity. Dates are strict `YYYY-MM-DD` values; departure is exclusive and must follow arrival. Stays are bounded to 365 nights and quantity to 1-50 units.

External providers added later must translate into this normalized contract rather than leaking provider-specific models into booking logic.

## Physical capacity and availability windows

Baseline hospitality capacity comes from ACTIVE physical `HospitalityRoom` records in the requested tenant/property/room type. `OUT_OF_SERVICE` and `ARCHIVED` rooms never count as sellable capacity.

Persisted `HospitalityAvailabilityWindow` records can reduce that baseline for an inclusive date range. A window stores tenant/property/room-type scope, start/end dates, a `capacityLimit` from 0-50, lifecycle timestamps, and archival status. Active windows for the same room type may not overlap.

A window can never increase sellable units above active physical inventory. A zero-capacity window closes inventory for its covered nights. Window creation and hold creation share the same room-type allocation lock, and a new window is rejected when its capacity would fall below units protected by active holds in the affected date range.

Window writes require `availability:manage`; reads require `availability:read`. Creation verifies the active tenant-owned room type, rejects active overlap, and writes a safe audit event. Archival is tenant-scoped and audited.

## Temporary holds

`HospitalityAvailabilityHold` is the first persisted allocation primitive. A hold stores organization/property/room-type/rate-plan scope, stay dates, quantity, bounded expiry, lifecycle status, and an organization-scoped idempotency key. The idempotency key is unique per tenant: an exact retry returns the original hold, while reusing the same key for a different payload is rejected.

Hold duration defaults to 15 minutes and is capped at 30 minutes. Hold creation requires `availability:manage`, validates the active room-type/rate-plan assignment and effective restrictions, then acquires a PostgreSQL transaction-scoped advisory lock for the tenant/property/room type before recalculating capacity and writing the hold in a serializable transaction. This serializes competing hold writes for shared physical capacity without introducing provider-specific behavior.

Capacity is evaluated per occupied night. For each night SF combines active physical rooms, any capacity window for that night, and all active unexpired overlapping holds. The normalized availability result exposes the minimum remaining sellable units across the full requested stay, so holds on separate nights are not incorrectly summed together.

Hold states are `ACTIVE`, `RELEASED`, and `EXPIRED`. Expiry correctness does not depend on a scheduler: reads and new allocations ignore an ACTIVE hold once `expiresAt` has passed. `expireHospitalityAvailabilityHolds` performs a bounded persisted transition to `EXPIRED` for cleanup/audit purposes, and explicit release is idempotent. No GitHub workflow or background CI mechanism is required.

Active holds protect their dependencies. A rate-plan assignment cannot be removed while an unexpired hold uses it, a physical room cannot be archived while doing so would reduce a room type with active holds, and a new capacity window cannot undercut units already held.

## Effective restrictions

Availability requires an active room type and active rate-plan assignment within the same tenant/property. It reads both property-wide and room-type-specific active restrictions for the requested rate plan.

Restriction evaluation is conservative: the highest applicable minimum stay wins, the lowest applicable maximum stay wins, and any applicable closed-to-arrival/departure rule closes that boundary. Machine-readable reasons include `insufficient-capacity`, `minimum-stay`, `maximum-stay`, `closed-to-arrival`, and `closed-to-departure`.

## Authorization and tenancy

Organization/platform admins and managers have `availability:manage`; staff have `availability:read`; customer-role organization memberships have no internal availability access. Every operation validates UUID inputs, authenticated tenant membership, permission, active parent records, and organization scope server-side.

## Validation coverage

The unit suite includes normalized request/restriction behavior, availability-window calculations, hold validation/idempotency matching, and per-night held-capacity calculations. The disposable PostgreSQL suite covers tenant isolation, physical capacity, out-of-service exclusion, effective restrictions, window authorization/overlap/capacity behavior, hold write authorization, idempotent retry, idempotency mismatch rejection, cross-tenant release denial, release/expiry capacity restoration, auditing, and two competing last-unit hold requests where only one may succeed.

A Node 24 environment and explicitly disposable PostgreSQL target are still required before full repository validation can be truthfully claimed as executed.

## Next dependencies

Temporary holds are not permanent booking allocations. The next availability dependency is a persisted booking allocation/confirmation boundary that converts or consumes a valid hold atomically, defines the no-overbooking policy at booking confirmation, and adds last-unit booking concurrency tests. Phase 10 pricing also remains required before the complete booking flow can be implemented.
