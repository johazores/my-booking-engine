# Availability

## Status

SF now implements the first normalized availability read boundary for hospitality. It evaluates a requested property, room type, rate plan, stay dates, and unit quantity against real active inventory and active hospitality restrictions. Persisted availability windows, holds, expiry, permanent booking allocations, and atomic booking confirmation remain incomplete dependencies and are not represented as finished.

## Normalized request contract

Availability requests use a provider-independent application shape:

- `propertyId`
- `roomTypeId`
- `ratePlanId`
- arrival date
- departure date
- requested unit quantity

Dates are strict `YYYY-MM-DD` calendar dates. Departure is exclusive and must be after arrival. Stays are currently bounded to 365 nights and requested units to 1-50.

This request contract belongs to the core application and does not expose provider-specific fields. External supplier adapters added later must translate into this normalized boundary instead of leaking their models into booking logic.

## Hospitality baseline capacity

The current hospitality capacity source is deliberately concrete: active physical `HospitalityRoom` records belonging to the requested tenant/property/room type. `OUT_OF_SERVICE` and `ARCHIVED` rooms do not count as sellable capacity.

The baseline availability result returns physical units, current sellable units, requested units, and remaining units. At this stage sellable units equal active physical units because availability windows, holds, and booking allocations are not implemented yet.

This is intentionally not a fake real-time availability claim. Once persisted windows and holds exist, they will reduce or constrain the same normalized capacity result.

## Effective restrictions

Availability requires an active room type and active rate plan assignment within the same tenant/property. It reads both property-wide and room-type-specific active restrictions for the requested rate plan.

Restriction evaluation is conservative:

- the highest applicable minimum-stay value wins
- the lowest applicable maximum-stay value wins
- any applicable closed-to-arrival rule closes arrival
- any applicable closed-to-departure rule closes departure

The result exposes machine-readable unavailability reasons such as `insufficient-capacity`, `minimum-stay`, `maximum-stay`, `closed-to-arrival`, and `closed-to-departure`.

## Authorization and tenancy

`availability:read` protects availability reads. Organization/platform admins and managers also receive `availability:manage` for the upcoming window/hold management boundary. Staff receive read-only availability access. Customer-role organization memberships do not receive internal availability access.

Every read validates UUID inputs, authenticated tenant membership/permission, active parent records, property/room-type/rate-plan assignment, and organization scope server-side. Browser values are never tenant authority.

## Validation coverage

The standard unit suite includes normalized availability date/request and restriction-combination tests. The disposable PostgreSQL suite includes hospitality availability integration coverage for tenant isolation, role access, active physical-room capacity, out-of-service exclusion, quantity exhaustion, and effective minimum-stay restrictions.

The repository still requires an available Node 24 environment and explicitly disposable PostgreSQL target before those full validation commands can be truthfully claimed as executed.

## Next dependencies

The next availability work should add persisted date windows and concurrency-safe holds, then hold expiration and permanent booking allocation/atomic confirmation. Those writes must be designed together so a last-unit race cannot oversell inventory.
