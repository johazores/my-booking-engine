# Rental booking unit substitution authority

SF has a read-only, staff-only authority preflight for a deliberately narrow physical-unit substitution contract. It answers whether one confirmed tenant rental booking could move from its current physical unit to another active unit **of the same unit type at the same operating location** without changing dates or accepted money.

The preflight is not a booking mutation. It does not reserve the target unit, update `RentalBooking`, update `RentalBookingAllocation`, create a new commercial record, or expose an Apply action.

## Why the contract is narrow

The current rental booking keeps original booking-time unit, unit type, location, dates, money, and pricing evidence immutable. Date-only rescheduling already changes only the effective allocation dates while preserving append-only reschedule evidence.

A physical-unit replacement therefore cannot safely be implemented as `allocation.unitId = targetUnitId` alone. The current database guards intentionally require the allocation unit to equal the immutable booking-time unit. A production writer must first introduce append-only substitution evidence and make database allocation authority derive the current effective unit from that history, just as rescheduling derives current effective dates from append-only history.

Keeping this review same-type and same-location avoids inventing product changes, transfer/location semantics, repricing, tax changes, payment adjustments, or fulfillment consequences.

## Authorization and tenant scope

Candidate search requires:

- `booking:manage`
- `inventory:read`

Fresh authority review additionally requires `availability:read`.

Every booking, target-unit, block, hold, allocation, and reschedule query repeats the authenticated `organizationId`. A target unit ID from another tenant, another unit type, another location, or an inactive lifecycle is returned only as unavailable target authority; the identifier never grants scope.

The page also requires `booking:read` for the staff booking surface. UI permission checks are usability only; the server services enforce their own permissions independently.

## Candidate search

`searchRentalBookingUnitSubstitutionCandidates` first proves that the tenant-owned booking is still `CONFIRMED`, not cancelled, and has the exact current allocation. Effective dates come from the latest append-only reschedule target when present, otherwise from the immutable booking-time dates.

It then returns at most 50 active physical units that:

- belong to the same organization;
- share the booking's retained unit type;
- share the booking's retained operating location;
- are not the current physical unit;
- have active unit-type and location parents.

Optional unit code/name search is bounded to 80 characters. Candidate search is inventory discovery only and does not claim target availability.

## Fresh authority review

`reviewRentalBookingUnitSubstitutionAuthority` uses a serializable read transaction and PostgreSQL `clock_timestamp()` for effective-hold decisions. It rechecks:

- confirmed, uncancelled tenant booking lifecycle;
- exact current allocation and effective reschedule dates;
- active/consistent source unit, unit type, and operating location;
- active target unit in the same tenant, unit type, and location;
- unavailable-date blocks on the target unit;
- effective `ACTIVE` target-unit holds whose expiry is still in the future by database time;
- overlapping allocations whose parent rental booking is not cancelled.

Review blockers are:

- `NO_CHANGE` — source and target units are identical;
- `TARGET_UNAVAILABLE` — target identity/lifecycle/type/location does not satisfy the supported contract;
- `INVENTORY_CONFLICT` — target inventory is blocked for the exact effective period.

## Authority fingerprint

A ready review returns a deterministic SHA-256 authority fingerprint binding:

- version 1;
- organization and booking IDs;
- observed booking `updatedAt` version;
- source and target physical unit IDs;
- retained unit type and operating location IDs;
- exact effective start/end dates;
- accepted currency and total minor units;
- effective pricing fingerprint, including the latest append-only reschedule pricing fingerprint when applicable.

The fingerprint is server-side review evidence only. It is not write authority by itself and is not persisted by this slice.

## Staff UX

`/inventory/rentals/bookings/[booking-id]/unit-substitution` provides bounded candidate search and fresh read-only authority review. The page is explicit that the review reserves nothing and changes nothing. No POST route or Apply button exists.

## Required writer boundary before activation

A future durable substitution writer must be implemented as one coherent persistence boundary. At minimum it must:

1. add append-only tenant-scoped substitution evidence with stable server-derived idempotency;
2. serialize the booking plus both source and target physical units in deterministic lock order;
3. rebuild fresh authority after locks are acquired;
4. reject stale booking version, source allocation, lifecycle, target inventory, type, or location evidence;
5. move only the effective allocation unit while preserving immutable booking-time unit evidence;
6. update database allocation/booking/reschedule guards so the effective unit is derived from latest substitution history rather than weakening ownership constraints;
7. prevent races with holds, blocks, relocation/archive, rescheduling, cancellation, and another substitution;
8. retain append-only audit evidence without customer or secret data;
9. support idempotent replay without making a stale target look current;
10. add guarded PostgreSQL concurrency and cross-tenant coverage.

Location-changing substitution, unit-type changes, price-changing amendments, payments/deposits, cancellation financial policy, pickup/delivery/return, and fulfillment remain separate commercial contracts.

## Validation boundary

Focused dependency-free tests protect deterministic authority fingerprinting, bounded search, server authorization, tenant-scoped candidate/target queries, database-time hold checks, inventory-conflict checks, and the deliberate absence of a mutation action.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database behavior must be validated through `npm run test:database` against an explicitly disposable PostgreSQL target once the durable writer exists. GitHub Actions are not required or used.
