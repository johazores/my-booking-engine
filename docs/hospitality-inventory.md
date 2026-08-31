# Hospitality Inventory

## Status

SF implements the first internal-inventory production slice for hospitality: tenant-owned properties, room types, and physical rooms. Amenities, images, rate plans, restrictions, availability, and pricing remain separate future dependencies and are not represented as complete.

## Domain hierarchy

```text
Organization
  -> HospitalityProperty
       -> HospitalityRoomType
            -> HospitalityRoom
```

The hierarchy is intentional rather than a generic inventory abstraction. A property is the hotel/resort location, a room type describes a sellable category, and a room is a physical unit. Later availability and pricing layers can reference these stable records without coupling hospitality to tours, appointments, or rentals.

## Tenant ownership and relational safety

Every property has `organizationId`. Room types and rooms also carry organization scope for efficient tenant queries, while composite foreign keys reinforce the parent tenant relationship:

- room type `(propertyId, organizationId)` must reference the same property tenant
- room `(roomTypeId, propertyId, organizationId)` must reference the same room-type/property tenant

Repository reads always include organization scope. Write services derive the organization from the authenticated active tenant, require authorization, validate UUIDs, and verify active parent ownership before creating child records. Browser form values never establish tenant ownership.

## Permissions

- platform admins and organization admins can read/manage inventory
- organization managers can read/manage inventory
- organization staff can read inventory but cannot mutate it
- customer-role members have no organization inventory access

`inventory:read` and `inventory:manage` are enforced by server services, not only navigation/UI visibility.

## Lifecycle

Properties and room types use `ACTIVE` / `ARCHIVED`. Rooms use `ACTIVE` / `OUT_OF_SERVICE` / `ARCHIVED`; the first UI slice creates active rooms and supports safe archival, while operational out-of-service transitions are reserved for the availability/operations dependency that can define their consequences correctly.

Archival requires explicit `ARCHIVE` confirmation and is dependency-safe:

- a property cannot be archived while active room types remain
- a room type cannot be archived while non-archived rooms remain
- rooms can be archived individually

History is preserved instead of destructively deleting inventory that future bookings may reference.

## Validation and uniqueness

Inventory codes are canonical uppercase 1–32 character identifiers using letters, numbers, `_`, and `-`.

- property code is unique per organization
- room-type code is unique per property
- room code is unique per property
- property timezone must be a valid IANA timezone
- property country is stored as a two-letter uppercase country code
- room-type maximum occupancy is 1–50

Collections are bounded and paginated with a default page size of 20 and maximum of 50.

## Auditing

Create/archive operations write safe `AuditEvent` entries containing identifiers, code/status, and lifecycle state only. No guest data, credentials, or secrets are copied into inventory audit payloads.

## UI

`/inventory` is part of the authenticated application shell. It provides real persisted property creation/listing and property detail workflows for room types and rooms. The interface includes empty, permission, validation/error, success, archived/read-only, loading, pagination, responsive, keyboard/focus, and explicit destructive-confirmation states.

## Validation

The standard unit-test command includes hospitality domain tests. `npm run test:database` includes a PostgreSQL integration flow that exercises permissions, Tenant A/Tenant B parent isolation, hierarchy creation, pagination, dependency-safe archival, and audit records after migrations are deployed to an explicitly disposable database.
