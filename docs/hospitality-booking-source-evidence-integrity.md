# Hospitality booking source evidence integrity

Hospitality booking and allocation rows are durable commercial and inventory evidence. Application services already authorize and tenant-scope supported mutations; PostgreSQL also prevents direct writers from rewriting the row identities, creation chronology, terminal inventory history, or retained allocation ownership those services, audits, pricing evidence, availability, and stale-authority checks rely on.

## Booking identity

`HospitalityBooking.id` and `createdAt` are immutable after creation. PostgreSQL rejects updates to either field with a constraint-style error before the write can become durable.

`HospitalityBooking.updatedAt` is a separate concurrency/version authority. PostgreSQL authors it on every booking update with `clock_timestamp()` and a strict one-microsecond monotonic floor, so callers cannot forge an old or future booking version.

The booking lifecycle and commercial fields remain mutable only through their existing authorized workflows. This identity guard does not introduce a new booking mutation path.

## Allocation identity and ownership

`HospitalityBookingAllocation.id`, `createdAt`, `organizationId`, and `bookingId` are immutable after creation. A direct writer therefore cannot re-parent a retained allocation to another booking or tenant, replace its durable allocation identity, or rewrite allocation creation chronology while leaving higher-level booking evidence intact.

The allocation's property/room-type assignment, stay dates, and quantity remain outside the identity trigger because supported hospitality reschedule and commercial-modification workflows can change effective allocation state. Those services keep their existing tenant, lifecycle, inventory, pricing, locking, and compare-and-set checks.

Every retained hospitality booking must also retain its allocation row. PostgreSQL preflights existing bookings during the retention migration and rejects a standalone allocation deletion while the owning tenant booking still exists. The deletion constraint is deferred so coherent teardown can remove the allocation and parent booking in the same transaction without weakening normal production retention.

## Cancelled allocation history

Cancellation is a retained lifecycle transition. Before applying `CONFIRMED -> CANCELLED`, the cancellation service requires the tenant-owned allocation to match the booking's current property, room type, stay dates, and quantity under the existing booking/allocation locks. Missing or mismatched retained allocation evidence fails closed instead of letting cancellation freeze an incoherent commercial inventory snapshot.

After cancellation, PostgreSQL rejects changes to the allocation's `propertyId`, `roomTypeId`, `arrivalDate`, `departureDate`, or `quantity`. Confirmed bookings can still use the established reschedule and commercial-modification workflows while their lifecycle authority is valid; the terminal guard only freezes the final allocation inventory snapshot once the booking is cancelled.

Availability releases the cancelled inventory by ignoring allocations whose owning booking is `CANCELLED`; release therefore does not require rewriting or deleting the retained allocation row. The status-independent deletion guard keeps that row as durable evidence after cancellation and also prevents direct removal of live booking capacity evidence before cancellation.

See [hospitality-cancelled-allocation-history-integrity.md](./hospitality-cancelled-allocation-history-integrity.md).

## Validation

`scripts/hospitality-booking-identity-integrity-source-contract.test.mjs` protects the PostgreSQL identity guards, guarded database regression assertions, and the base documentation contract. `scripts/hospitality-cancelled-allocation-history-integrity-source-contract.test.mjs` additionally protects cancellation allocation coherence, the terminal allocation-history guard, status-independent allocation retention, migration preflight, guarded database coverage, coordinated fixture teardown, database-suite registration, and the availability/documentation boundary.

Full database execution still requires the repository's explicitly disposable PostgreSQL path. GitHub Actions are intentionally not used.
