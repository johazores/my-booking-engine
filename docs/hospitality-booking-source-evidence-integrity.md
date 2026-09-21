# Hospitality booking source evidence integrity

Hospitality booking and allocation rows are durable commercial and inventory evidence. Application services already authorize and tenant-scope supported mutations; PostgreSQL now also prevents direct writers from rewriting the row identities and creation chronology those services, audits, pricing evidence, and stale-authority checks rely on.

## Booking identity

`HospitalityBooking.id` and `createdAt` are immutable after creation. PostgreSQL rejects updates to either field with a constraint-style error before the write can become durable.

`HospitalityBooking.updatedAt` is a separate concurrency/version authority. PostgreSQL authors it on every booking update with `clock_timestamp()` and a strict one-microsecond monotonic floor, so callers cannot forge an old or future booking version.

The booking lifecycle and commercial fields remain mutable only through their existing authorized workflows. This identity guard does not introduce a new booking mutation path.

## Allocation identity and ownership

`HospitalityBookingAllocation.id`, `createdAt`, `organizationId`, and `bookingId` are immutable after creation. A direct writer therefore cannot re-parent a retained allocation to another booking or tenant, replace its durable allocation identity, or rewrite allocation creation chronology while leaving higher-level booking evidence intact.

The allocation's property/room-type assignment, stay dates, and quantity are intentionally outside this identity trigger because supported hospitality reschedule and commercial-modification workflows can change effective allocation state. Those services keep their existing tenant, lifecycle, inventory, pricing, locking, and compare-and-set checks.

This migration does not change allocation deletion/retention semantics. Destructive historical-retention policy has different lifecycle and teardown acceptance criteria and remains outside this identity-only boundary.

## Validation

`scripts/hospitality-booking-identity-integrity-source-contract.test.mjs` protects both PostgreSQL guards, the guarded database regression assertions, and the documentation contract. The database scenario is registered through the existing hospitality booking version-authority integration file, so the same real hold → pricing → confirmation fixture exercises both booking-version and durable-identity protection.

Full database execution still requires the repository's explicitly disposable PostgreSQL path. GitHub Actions are intentionally not used.
