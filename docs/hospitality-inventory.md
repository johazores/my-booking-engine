# Hospitality Inventory

## Status

SF implements tenant-owned hospitality properties, room types, physical rooms, amenities, and image galleries end to end. Images support property and room-type scopes using real HTTPS-hosted assets, required accessible alt text, display order, primary-image selection, server-side authorization and tenant scope, audited lifecycle operations, responsive authenticated UI, and checked-in PostgreSQL integration coverage. Rate plans, restrictions, availability, and pricing remain separate future dependencies.

## Domain hierarchy

```text
Organization
  -> HospitalityProperty
       -> HospitalityRoomType
            -> HospitalityRoom
            -> HospitalityRoomTypeImage
       -> HospitalityPropertyImage
  -> HospitalityAmenity
       -> property assignments
       -> room-type assignments
```

The hierarchy is intentional rather than a generic inventory abstraction. A property is the hotel/resort location, a room type describes a sellable category, and a room is a physical unit. Amenities are reusable tenant-owned definitions rather than comma-separated labels. Images use explicit property and room-type records so PostgreSQL can enforce the real parent hierarchy without a polymorphic target column. Later availability, pricing, public search, and filtering layers can reference these stable records without coupling hospitality to tours, appointments, or rentals.

## Tenant ownership and relational safety

Every property has `organizationId`. Room types, rooms, amenities, and images also carry organization scope for efficient tenant queries, while composite foreign keys reinforce parent ownership:

- room type `(propertyId, organizationId)` must reference the same property tenant
- room `(roomTypeId, propertyId, organizationId)` must reference the same room-type/property tenant
- property amenity assignments reference both property and amenity using the same `organizationId`
- room-type amenity assignments reference the room-type/property hierarchy and amenity using the same `organizationId`
- property images reference `(propertyId, organizationId)`
- room-type images reference `(roomTypeId, propertyId, organizationId)`

Repository/service reads always include organization scope. Write services derive the organization from the authenticated active tenant, require authorization, validate UUIDs, and verify active parent ownership before creating or changing child records. Browser form values never establish tenant ownership.

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

Amenity assignments are explicitly removable and audited. Repeating the same assignment is idempotent and does not write duplicate audit events. Historical top-level inventory records are archived instead of destructively deleted.

Images are media metadata rather than commercial booking records. They can be explicitly removed while their parent is active; removal is audited without copying the URL into audit JSON. Once a property or room type is archived, its image gallery becomes read-only so crafted requests cannot mutate archived inventory history.

## Image contract

SF currently stores stable HTTPS-hosted image references. This is a real usable workflow for tenants that already have CDN/media hosting; SF does not present a fake file-upload integration.

Each image stores:

- tenant and explicit property/room-type ownership
- HTTPS URL, maximum 2048 characters, with embedded credentials rejected
- required normalized alt text up to 200 characters
- display order from 0–9999
- primary-image state

The first image in a scope automatically becomes primary. Setting another image primary happens inside a serializable transaction and clears the previous primary in the same scope. Re-selecting the existing primary is idempotent and does not create a duplicate audit event. Galleries are currently bounded to 50 images per scope.

A future direct-upload feature must use a real storage-provider adapter and feed the same normalized image records. Provider-specific upload credentials, signed-upload behavior, and storage APIs must not leak into the hospitality inventory domain.

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
- image URLs and metadata are validated in both application code and PostgreSQL checks where applicable

Collections are bounded and paginated with a default page size of 20 and maximum of 50 where pagination is exposed. Amenity definitions remain a bounded tenant configuration set in the current management surface; pagination must be added before this becomes a large standalone catalog.

## Auditing

Create/archive operations write safe `AuditEvent` entries containing identifiers, code/status, and lifecycle state only. Amenity creation, assignment, removal, and archival are audited using safe identifiers. Image creation, primary changes, and removals are audited using resource IDs, parent IDs, primary state, and display order; image URLs are intentionally excluded from audit JSON. No guest data, credentials, signed media URLs, or secrets are copied into inventory audit payloads.

## UI

`/inventory` is part of the authenticated application shell and provides persisted property creation/listing plus property detail workflows for room types and rooms. Each property exposes its real image-management surface at `/inventory/[property-id]/images`.

`/inventory/amenities` manages reusable amenity definitions and lifecycle. Property detail pages expose property-level amenity assignment/removal, and the selected room-type surface exposes room-type assignment/removal.

The image surface switches between the property gallery and paginated room-type scopes, previews configured assets with their real alt text, exposes set-primary/remove controls only when the actor and parent lifecycle permit them, and provides a hosted-image form with validation guidance. It explicitly states that SF accepts an existing production HTTPS asset URL rather than implying file upload support.

All inventory mutation routes are same-origin, authenticated, tenant-scoped handlers calling permission-checked server services.

## Validation

The standard unit-test command includes hospitality domain tests, including amenity and image normalization/validation. `npm run test:database` includes the hospitality PostgreSQL integration flow covering Tenant A/Tenant B isolation, staff mutation denial, hierarchy creation, amenities, image creation/listing/primary ordering, archived-scope mutation denial, lifecycle behavior, and audit records after migrations are deployed to an explicitly disposable database.
