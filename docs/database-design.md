# Database Design

## Database choice

SF uses PostgreSQL because reservations, payments, availability, memberships, and audit history benefit from transactions, relational constraints, indexing, and explicit data ownership.

Prisma ORM is the TypeScript data-access layer.

## Implemented models

### Organization

Represents a tenant/business. It includes a stable UUID, unique slug, business kind, status, timezone, currency, timestamps, and soft-deletion timestamp.

### User

Represents a platform identity record. Authentication details are intentionally not modeled until the authentication slice is implemented.

### OrganizationMembership

Connects users to organizations. The unique `(organizationId, userId)` constraint prevents duplicate membership records. Indexes support tenant and user membership lookups.

## Tenant ownership rule

Future tenant-owned records must contain an organization identifier or otherwise have an unambiguous relational path to exactly one organization. Tenant security cannot depend on a frontend filter or route parameter alone.

## Planned domain modeling

Future schemas should model real business relationships rather than mirror UI pages. Important expected areas include:

- customers/travelers/guests
- properties, room types, rooms, rates, restrictions
- tours, schedules, capacity
- services, staff, schedules
- rental products and locations
- availability allocations and holds
- bookings and booking items
- payments, refunds, reconciliation references
- provider integrations and encrypted credentials
- audit records

## State and history

Booking state and payment state must be separate when workflows can diverge. Commercial history should prefer state transitions, audit records, and soft deletion over destructive deletion.

## Concurrency

Availability cannot be implemented as an unsafe read-then-decrement counter. The eventual availability design must support atomic confirmation, capacity/allocations, temporary holds, expiry, restrictions, and overbooking rules where the business permits them.
