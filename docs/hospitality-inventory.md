# Hospitality Inventory

## Status

SF implements tenant-owned hospitality properties, room types, physical rooms, amenities, image galleries, and rate-plan configuration end to end. Rate plans are property-owned commercial definitions that can be assigned to room types without prematurely embedding prices or date restrictions into inventory records. Restrictions remain the next hospitality dependency; availability and pricing remain later platform phases.

## Domain hierarchy

```text
Organization
  -> HospitalityProperty
       -> HospitalityRoomType
            -> HospitalityRoom
            -> HospitalityRoomTypeImage
            -> HospitalityRoomTypeRatePlan assignments
       -> HospitalityPropertyImage
       -> HospitalityRatePlan
  -> HospitalityAmenity
       -> property assignments
       -> room-type assignments
```

The hierarchy is intentional rather than a generic inventory abstraction. A property is the hotel/resort location, a room type describes a sellable category, and a room is a physical unit. Amenities are reusable tenant-owned definitions rather than comma-separated labels. Images use explicit property and room-type records so PostgreSQL can enforce the real parent hierarchy without a polymorphic target column.

Rate plans are property-owned because a commercial plan such as Flexible or Advance Purchase is normally reused across multiple room types at the same property. The assignment table records which room types participate in a plan. Phase 10 pricing can later attach money/rate records to these stable identities, and restrictions can target the same property/rate-plan/room-type hierarchy without duplicating plan names.

## Tenant ownership and relational safety

Every property has `organizationId`. Room types, rooms, amenities, images, rate plans, and assignment rows also carry organization scope where needed for efficient tenant queries. Composite foreign keys reinforce parent ownership:

- room type `(propertyId, organizationId)` must reference the same property tenant
- room `(roomTypeId, propertyId, organizationId)` must reference the same room-type/property tenant
- property amenity assignments reference both property and amenity using the same `organizationId`
- room-type amenity assignments reference the room-type/property hierarchy and amenity using the same `organizationId`
- property images reference `(propertyId, organizationId)`
- room-type images reference `(roomTypeId, propertyId, organizationId)`
- rate plans reference `(propertyId, organizationId)`
- room-type rate-plan assignments reference both `(roomTypeId, propertyId, organizationId)` and `(ratePlanId, propertyId, organizationId)`

The rate-plan assignment constraints prevent cross-tenant **and cross-property** attachment even if application validation is bypassed.

Repository/service reads always include organization scope. Write services derive the organization from the authenticated active tenant, require authorization, validate UUIDs, and verify active parent ownership before creating or changing child records. Browser form values never establish tenant ownership.

## Permissions

- platform admins and organization admins can read/manage inventory
- organization managers can read/manage inventory
- organization staff can read inventory but cannot mutate it
- customer-role members have no organization inventory access

`inventory:read` and `inventory:manage` are enforced by server services, not only navigation/UI visibility.

## Lifecycle

Properties, room types, amenities, and rate plans use `ACTIVE` / `ARCHIVED`. Rooms use `ACTIVE` / `OUT_OF_SERVICE` / `ARCHIVED`; operational out-of-service transitions remain reserved for the availability/operations dependency that can define their consequences correctly.

Archival requires explicit `ARCHIVE` confirmation where exposed and is dependency-safe:

- a property cannot be archived while active room types remain
- a room type cannot be archived while non-archived rooms remain
- rooms can be archived individually
- an amenity cannot be archived while any property or room-type assignment remains
- a rate plan cannot be archived while any room-type assignment remains

Amenity and rate-plan assignments are explicitly removable and audited. Repeating the same assignment is idempotent and does not write duplicate audit events. Historical top-level inventory records are archived instead of destructively deleted.

An archived parent always makes descendants/configuration operationally unavailable even if a child record retains its own historical `ACTIVE` status. Mutation services require active parent scope before creating or assigning commercial configuration.

Images are media metadata rather than commercial booking records. They can be explicitly removed while their parent is active; removal is audited without copying the URL into audit JSON. Once a property or room type is archived, its image gallery becomes read-only so crafted requests cannot mutate archived inventory history.

## Rate-plan contract

A hospitality rate plan stores:

- stable UUID identity
- organization/property ownership
- property-local canonical code
- normalized name
- optional normalized description up to 300 characters
- lifecycle state and timestamps

Rate plans intentionally do **not** store nightly prices, taxes, fees, cancellation-policy execution, minimum stays, closed-to-arrival/departure flags, or inventory counts. Those belong to restrictions, availability, and pricing layers so commercial identities do not become overloaded mutable blobs.

Room-type assignment is idempotent. The first assignment writes one audit event; repeating the same assignment returns the existing relationship without creating duplicate audit history. Removing an assignment is explicit and audited.

The authenticated rate-plan surface is paginated for both rate-plan records and room-type assignment candidates, so the workflow remains usable for large properties without unbounded collection reads.

## Image contract

SF currently stores stable HTTPS-hosted image references. This is a real usable workflow for tenants that already have CDN/media hosting; SF does not present a fake file-upload integration.

Each image stores tenant and explicit property/room-type ownership, HTTPS URL, required normalized alt text up to 200 characters, display order from 0–9999, primary-image state, and timestamps. Embedded URL credentials are rejected.

The first image in a scope automatically becomes primary. Setting another image primary happens inside a serializable transaction and clears the previous primary in the same scope. Re-selecting the existing primary is idempotent and does not create a duplicate audit event. Galleries are currently bounded to 50 images per scope.

A future direct-upload feature must use a real storage-provider adapter and feed the same normalized image records. Provider-specific upload credentials, signed-upload behavior, and storage APIs must not leak into the hospitality inventory domain.

## Validation and uniqueness

Inventory, amenity, and rate-plan codes are canonical uppercase 1–32 character identifiers using letters, numbers, `_`, and `-`.

- property code is unique per organization
- room-type code is unique per property
- room code is unique per property
- amenity code is unique per organization
- rate-plan code is unique per property
- property timezone must be a valid IANA timezone
- property country is stored as a two-letter uppercase country code
- room-type maximum occupancy is 1–50
- amenity and rate-plan names are normalized non-empty values up to 120 characters
- image URLs and metadata are validated in both application code and PostgreSQL checks where applicable

Collections are bounded and paginated with a default page size of 20 and maximum of 50 where pagination is exposed. Amenity definitions remain a bounded tenant configuration set in the current management surface; pagination must be added before this becomes a large standalone catalog.

## Auditing

Create/archive operations write safe `AuditEvent` entries containing identifiers, code/status, and lifecycle state only. Amenity creation, assignment, removal, and archival are audited using safe identifiers. Rate-plan creation, room-type assignment/removal, and archival are audited using property/room-type IDs and stable plan metadata without pricing or guest data. Image creation, primary changes, and removals are audited using resource IDs, parent IDs, primary state, and display order; image URLs are intentionally excluded from audit JSON.

No guest data, credentials, signed media URLs, payment information, or secrets are copied into inventory audit payloads.

## UI

`/inventory` is part of the authenticated application shell and provides persisted property creation/listing plus property detail workflows for room types and rooms. Property cards expose real management links for rate plans and images.

`/inventory/amenities` manages reusable amenity definitions and lifecycle. Property detail pages expose property-level amenity assignment/removal, and the selected room-type surface exposes room-type assignment/removal.

Each property exposes `/inventory/[property-id]/rate-plans`, which provides paginated rate-plan creation/listing, selected-plan room-type assignment/removal, lifecycle states, dependency-safe archival, permission/read-only states, validation feedback, and links back to the property and image management surfaces.

Each property exposes its image-management surface at `/inventory/[property-id]/images`. It switches between property and paginated room-type scopes, previews configured assets with their real alt text, and exposes set-primary/remove controls only when actor and parent lifecycle permit them.

All inventory mutation routes are same-origin, authenticated, tenant-scoped handlers calling permission-checked server services.

## Validation

The standard unit-test command includes hospitality domain tests, including amenity, image, and rate-plan normalization/validation. `npm run test:database` includes hospitality PostgreSQL integration coverage for Tenant A/Tenant B isolation, staff mutation denial, hierarchy creation, amenities, images, rate-plan creation/assignment/removal, assignment idempotency, dependency-safe archival, lifecycle behavior, and audit records after migrations are deployed to an explicitly disposable database.
