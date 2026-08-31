# Hospitality Inventory

## Status

SF implements tenant-owned hospitality properties, room types, physical rooms, and amenities end to end. Amenities have reusable tenant-owned definitions, create/archive lifecycle, property and room-type assignment/removal controls, server-side authorization and tenant scope, audited idempotent assignment mutations, responsive authenticated UI, and checked-in PostgreSQL integration coverage. Images, rate plans, restrictions, availability, and pricing remain separate future dependencies.

## Domain hierarchy

```text
Organization
  -> HospitalityProperty
       -> HospitalityRoomType
            -> HospitalityRoom
  -> HospitalityAmenity
       -> property assignments
       -> room-type assignments
```

The hierarchy is intentional rather than a generic inventory abstraction. A property is the hotel/resort location, a room type describes a sellable category, and a room is a physical unit. Amenities are reusable tenant-owned definitions rather than comma-separated labels, allowing the same canonical amenity to be assigned to multiple properties or room types. Later availability, pricing, public search, and filtering layers can reference these stable records without coupling hospitality to tours, appointments, or rentals.

## Tenant ownership and relational safety

Every property has `organizationId`. Room types and rooms also carry organization scope for efficient tenant queries, while composite foreign keys reinforce the parent tenant relationship:

- room type `(propertyId, organizationId)` must reference the same property tenant
- room `(roomTypeId, propertyId, organizationId)` must reference the same room-type/property tenant
- property amenity assignments reference both property and amenity using the same `organizationId`
- room-type amenity assignments reference the room-type/property hierarchy and amenity using the same `organizationId`

Repository reads always include organization scope. Write services derive the organization from the authenticated active tenant, require authorization, validate UUIDs, and verify active parent ownership before creating child records or amenity assignments. Assignment removal also carries organization plus parent/resource IDs and never deletes through a globally loaded assignment ID. Browser form values never establish tenant ownership.

## Permissions

- platform admins and organization admins can read/manage inventory
- organization managers can read/manage inventory
- organization staff can read inventory but cannot mutate it
- customer-role members have no organization inventory access

`inventory:read` and `inventory:manage` are enforced by server services, not only navigation/UI visibility.

## Lifecycle

Properties, room types, and amenities use `ACTIVE` / `ARCHIVED`. Rooms use `ACTIVE` / `OUT_OF_SERVICE` / `ARCHIVED`; operational out-of-service transitions remain reserved for the availability/operations dependency that can define their consequences correctly.

Archival requires explicit `ARCHIVE` confirmation and is dependency-safe:

- a property cannot be archived while active room types remain
- a room type cannot be archived while non-archived rooms remain
- rooms can be archived individually
- an amenity cannot be archived while any property or room-type assignment remains

Amenity assignments are explicitly removable and those removals are audited. Repeating the same assignment is idempotent: the existing assignment is returned without writing duplicate audit events. Historical top-level inventory records are archived instead of destructively deleted.

## Validation and uniqueness

Inventory and amenity codes are canonical uppercase 1–32 character identifiers using letters, numbers, `_`, and `-`.

- property code is unique per organization
- room-type code is unique per property
- room code is unique per property
- amenity code is unique per organization
- property timezone must be a valid IANA timezone
- property country is stored as a two-letter uppercase country code
- room-type maximum occupancy is 1–50
- amenity names are normalized non-empty values up to 120 characters

Collections are bounded and paginated with a default page size of 20 and maximum of 50 where pagination is currently exposed. Amenity definitions remain a bounded tenant configuration set in the current management surface; pagination must be added before this becomes a large standalone catalog.

## Auditing

Create/archive operations write safe `AuditEvent` entries containing identifiers, code/status, and lifecycle state only. Amenity creation, assignment, removal, and archival are audited using safe amenity/property/room-type identifiers. No guest data, credentials, or secrets are copied into inventory audit payloads.

## UI

`/inventory` is part of the authenticated application shell and provides persisted property creation/listing plus property detail workflows for room types and rooms.

`/inventory/amenities` manages reusable amenity definitions and lifecycle. Property detail pages expose property-level amenity assignment/removal, and the selected room-type surface exposes room-type assignment/removal. The UI hides mutations for read-only roles and archived parents, excludes already assigned or archived amenity definitions from assignment selectors, preserves the selected room type after mutations, and includes empty, validation/error, success, disabled, responsive, and accessible form states.

All amenity mutation routes are same-origin, authenticated, tenant-scoped handlers calling permission-checked server services.

## Validation

The standard unit-test command includes hospitality domain tests, including amenity input normalization. `npm run test:database` includes the hospitality PostgreSQL integration flow covering Tenant A/Tenant B amenity assignment denial, property and room-type assignment reads/removal, dependency-safe amenity archival, repeat-assignment idempotency without duplicate audit events, permissions, hierarchy lifecycle, and audit records after migrations are deployed to an explicitly disposable database.
