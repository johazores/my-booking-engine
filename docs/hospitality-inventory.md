# Hospitality Inventory

## Status

SF implements the hospitality inventory foundation end to end: tenant-owned properties, room types, physical rooms, amenities, image galleries, rate plans, and restrictions. Availability and pricing remain later platform phases; restrictions establish commercial stay/arrival rules without embedding inventory counts or money into inventory records.

## Domain hierarchy

```text
Organization
  -> HospitalityProperty
       -> HospitalityRoomType
            -> HospitalityRoom
            -> HospitalityRoomTypeImage
            -> HospitalityRoomTypeRatePlan assignments
            -> optional HospitalityRestriction scope
       -> HospitalityPropertyImage
       -> HospitalityRatePlan
            -> HospitalityRestriction
  -> HospitalityAmenity
       -> property assignments
       -> room-type assignments
```

Properties, room types, rooms, amenities, images, rate plans, and restrictions remain hospitality-specific rather than being forced into a generic inventory abstraction. Tours, appointments, and rentals have different capacity and scheduling semantics and remain separate modules.

## Tenant ownership and relational safety

Every protected server operation derives organization scope from the authenticated active tenant and enforces `inventory:read` or `inventory:manage`. Browser-provided IDs never establish ownership.

Composite database relationships reinforce application authorization:

- room types reference `(propertyId, organizationId)`
- rooms reference `(roomTypeId, propertyId, organizationId)`
- amenity assignments require amenity and target inventory to share the same organization
- property and room-type images reference explicit tenant-safe parents
- rate plans reference `(propertyId, organizationId)`
- room-type rate-plan assignments require both room type and rate plan to share `(propertyId, organizationId)`
- restrictions reference `(ratePlanId, propertyId, organizationId)` and, when room-specific, `(roomTypeId, propertyId, organizationId)`

Room-specific restriction creation additionally requires the room type to have an active assignment to the selected rate plan. This assignment dependency is enforced in the service layer and covered by PostgreSQL integration tests.

## Permissions

- platform admins and organization admins can read/manage inventory
- organization managers can read/manage inventory
- organization staff can read inventory but cannot mutate it
- customer-role members have no organization inventory access

Permission checks are server-side and are not delegated to UI visibility.

## Lifecycle and dependency order

Properties, room types, amenities, rate plans, and restrictions use `ACTIVE` / `ARCHIVED`. Rooms use `ACTIVE` / `OUT_OF_SERVICE` / `ARCHIVED`; operational out-of-service transitions remain part of the later availability/operations layer.

Archival and relationship removal are dependency-safe:

- active room types must be archived before a property
- active rate plans must be archived before a property
- non-archived rooms and rate-plan assignments must be cleared before a room type
- amenity assignments must be removed before amenity archival
- room-type rate-plan assignments must be removed before rate-plan archival
- active room-specific restrictions must be archived before their rate-plan assignment can be removed
- all active restrictions must be archived before their rate plan can be archived

Restrictions are immutable commercial history records after creation. To change a rule, archive it and create a replacement. This preserves auditability and avoids silent mutation of previously configured date windows.

## Restriction contract

A `HospitalityRestriction` belongs to one property rate plan and optionally one assigned room type. Each rule has an inclusive `startDate` / `endDate` window and one or more of:

- minimum stay, 1–365 nights
- maximum stay, 1–365 nights
- closed to arrival
- closed to departure

The end date cannot precede the start date, minimum stay cannot exceed maximum stay, and a rule cannot be empty. PostgreSQL mirrors these invariants with check constraints.

Active date windows may not overlap within the same exact scope (same tenant/property/rate plan and same property-wide or room-type scope). Creation runs in a serializable transaction and rejects overlap before persistence. A property-wide rule and a room-specific rule may overlap intentionally; later availability evaluation can combine those scopes deterministically rather than treating them as duplicate rules.

Restrictions do not store prices, taxes, fees, capacity, holds, or booking state. Those remain in pricing, availability, and booking modules.

## Rate-plan contract

A hospitality rate plan stores stable UUID identity, organization/property ownership, property-local canonical code, normalized name, optional description, lifecycle, and timestamps. Room-type assignment is idempotent: repeating the same assignment does not create duplicate audit history.

Rate plans deliberately do not store monetary amounts or inventory counts. Restrictions reference stable rate-plan identities so later pricing and availability can consume the same commercial hierarchy without duplicating plan names.

## Image contract

SF stores real HTTPS-hosted image references for tenants that already have CDN/media hosting. It does not present a fake upload integration. Images carry explicit property or room-type ownership, required alt text, display order, primary state, and timestamps. Embedded URL credentials are rejected.

The first image in a scope becomes primary. Primary changes are transactional and idempotent. A future direct-upload capability must use a real storage-provider adapter and feed the same normalized image records.

## Validation and collection bounds

Inventory, amenity, and rate-plan codes are canonical uppercase 1–32 character identifiers using letters, numbers, `_`, and `-`.

- property code is unique per organization
- room-type code is unique per property
- room code is unique per property
- amenity code is unique per organization
- rate-plan code is unique per property
- property timezone is a valid IANA timezone
- property country is a two-letter uppercase country code
- room-type maximum occupancy is 1–50
- image and restriction metadata is validated before persistence and backed by PostgreSQL constraints where appropriate

Large management collections use bounded pagination with default page size 20 and maximum 50. Restriction rate plans, assigned room-type scopes, and restriction history are all paginated.

## Auditing

Important hospitality operations write `AuditEvent` records with safe identifiers and lifecycle/commercial metadata. Restriction creation records scope, date window, stay controls, and arrival/departure flags; archival records the lifecycle transition. No credentials, payment data, guest data, signed media URLs, or secrets are copied into audit payloads.

## UI

`/inventory` is the authenticated hospitality entry point. Property detail pages manage room types, physical rooms, and amenity assignment. Dedicated property surfaces manage images, rate plans, and restrictions.

`/inventory/[property-id]/restrictions` provides:

- paginated rate-plan selection
- property-wide or assigned-room-type scope selection
- persisted restriction listing and lifecycle states
- date/stay/arrival/departure validation
- overlap conflict feedback
- explicit archival confirmation
- permission-aware and archived/read-only states
- responsive server-rendered forms using the existing SF design system

All mutation routes are same-origin, authenticated handlers that call tenant-scoped permission-checked services.

## Validation

The standard unit-test command includes restriction normalization tests. `npm run test:database` includes PostgreSQL coverage for restriction permissions, Tenant A/Tenant B denial, rate-plan assignment requirements, allowed cross-scope overlap, rejected same-scope overlap, dependency-safe assignment/rate-plan/property lifecycle, and audit records after migrations are deployed to an explicitly disposable database.
