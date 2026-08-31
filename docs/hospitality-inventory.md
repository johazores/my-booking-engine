# Hospitality Inventory

## Status

SF implements the first internal-inventory production slice for hospitality: tenant-owned properties, room types, and physical rooms. The amenity data foundation is now also implemented: tenant-owned amenity definitions plus tenant-safe property and room-type assignments. Amenity management UI/removal lifecycle and PostgreSQL integration coverage are still incomplete, so the master checklist intentionally does not mark Amenities complete yet. Images, rate plans, restrictions, availability, and pricing remain separate future dependencies.

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

Repository reads always include organization scope. Write services derive the organization from the authenticated active tenant, require authorization, validate UUIDs, and verify active parent ownership before creating child records or amenity assignments. Browser form values never establish tenant ownership.

## Permissions

- platform admins and organization admins can read/manage inventory
- organization managers can read/manage inventory
- organization staff can read inventory but cannot mutate it
- customer-role members have no organization inventory access

`inventory:read` and `inventory:manage` are enforced by server services, not only navigation/UI visibility.

## Lifecycle

Properties, room types, and amenities use `ACTIVE` / `ARCHIVED`. Rooms use `ACTIVE` / `OUT_OF_SERVICE` / `ARCHIVED`; the first UI slice creates active rooms and supports safe archival, while operational out-of-service transitions are reserved for the availability/operations dependency that can define their consequences correctly.

Property and room-type archival requires explicit `ARCHIVE` confirmation and is dependency-safe:

- a property cannot be archived while active room types remain
- a room type cannot be archived while non-archived rooms remain
- rooms can be archived individually

Amenity archival/removal is not yet exposed as complete product behavior. The current amenity foundation supports creation, read access, and idempotent property/room-type assignment while preserving a separate lifecycle field for the follow-up management slice.

History is preserved instead of destructively deleting inventory that future bookings may reference.

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

Collections are bounded and paginated with a default page size of 20 and maximum of 50 where pagination is currently exposed. Amenity definitions are currently read as a bounded tenant configuration set; pagination should be added before the collection is exposed as a large standalone management directory.

## Auditing

Create/archive operations write safe `AuditEvent` entries containing identifiers, code/status, and lifecycle state only. Amenity creation and assignment operations are also audited using safe amenity/property/room-type identifiers. No guest data, credentials, or secrets are copied into inventory audit payloads.

## UI

`/inventory` is part of the authenticated application shell. It provides real persisted property creation/listing and property detail workflows for room types and rooms. The interface includes empty, permission, validation/error, success, archived/read-only, loading, pagination, responsive, keyboard/focus, and explicit destructive-confirmation states.

Amenity management is not yet surfaced as complete UI and therefore remains unchecked in issue #1 despite the persisted schema/service foundation now being present.

## Validation

The standard unit-test command includes hospitality domain tests, including amenity input normalization. `npm run test:database` currently includes the property/room-type/room PostgreSQL integration flow. The next amenity slice must extend that live-database suite with Tenant A/Tenant B amenity assignment isolation and lifecycle coverage before Amenities is marked complete.
