# Availability

## Status

SF implements a normalized hospitality availability read boundary plus persisted room-type availability windows. Availability evaluates tenant-owned property, room type, rate plan, stay dates, requested units, active physical rooms, active capacity windows, and active rate restrictions. Holds, expiration, permanent booking allocations, and atomic booking confirmation remain incomplete dependencies and are not represented as finished.

## Normalized request contract

Availability requests use a provider-independent application shape: `propertyId`, `roomTypeId`, `ratePlanId`, arrival date, departure date, and unit quantity. Dates are strict `YYYY-MM-DD` values; departure is exclusive and must follow arrival. Stays are bounded to 365 nights and quantity to 1-50 units.

External providers added later must translate into this normalized contract rather than leaking provider-specific models into booking logic.

## Physical capacity and availability windows

Baseline hospitality capacity comes from ACTIVE physical `HospitalityRoom` records in the requested tenant/property/room type. `OUT_OF_SERVICE` and `ARCHIVED` rooms never count as sellable capacity.

Persisted `HospitalityAvailabilityWindow` records can reduce that baseline for an inclusive date range. A window stores tenant/property/room-type scope, start/end dates, a `capacityLimit` from 0-50, lifecycle timestamps, and archival status. Active windows for the same room type may not overlap. This intentionally prevents contradictory capacity instructions and keeps later concurrency logic simpler.

A window can never increase sellable units above active physical inventory: effective capacity is the minimum of physical capacity and every applicable window capacity limit. A zero-capacity window closes inventory for its covered nights. Archived windows no longer affect reads.

Window writes require `availability:manage`; reads require `availability:read`. Creation verifies the active tenant-owned room type in a serializable transaction, rejects active overlap, and writes a safe audit event. Archival is tenant-scoped and audited.

## Effective restrictions

Availability requires an active room type and active rate-plan assignment within the same tenant/property. It reads both property-wide and room-type-specific active restrictions for the requested rate plan.

Restriction evaluation is conservative: the highest applicable minimum stay wins, the lowest applicable maximum stay wins, and any applicable closed-to-arrival/departure rule closes that boundary. Machine-readable reasons include `insufficient-capacity`, `minimum-stay`, `maximum-stay`, `closed-to-arrival`, and `closed-to-departure`.

## Authorization and tenancy

Organization/platform admins and managers have `availability:manage`; staff have `availability:read`; customer-role organization memberships have no internal availability access. Every operation validates UUID inputs, authenticated tenant membership, permission, active parent records, and organization scope server-side.

## Validation coverage

The unit suite includes normalized request/restriction behavior and availability-window date/capacity calculations. The disposable PostgreSQL suite covers tenant isolation, physical capacity, out-of-service exclusion, effective restrictions, window write authorization, active overlap rejection, window capacity reduction, cross-tenant archive denial, and capacity restoration after archival.

A Node 24 environment and explicitly disposable PostgreSQL target are still required before full repository validation can be truthfully claimed as executed.

## Next dependencies

The next availability work is concurrency-safe temporary holds and hold expiration. Holds must reduce the same effective capacity calculation and be designed together with permanent booking allocation and atomic confirmation so competing last-unit requests cannot oversell inventory.
