# Hospitality amenity collection bounds

Hospitality amenities are tenant-owned reusable inventory definitions. The management directory and the assignment pickers have different read requirements, so they deliberately use different bounded contracts instead of one unbounded list.

## Management directory

`/inventory/amenities` uses `listHospitalityAmenitiesPage` and the repository `listAmenitiesForOrganizationPage` boundary.

- reads require `inventory:read` before repository access;
- count and rows are always scoped by `organizationId`;
- requested pages default to page 1;
- requested page size defaults to 20 and is capped at 50 inside the repository boundary;
- ordering is deterministic by lifecycle status, name, and stable ID;
- out-of-range pages clamp to the last available page;
- the scoped count, resolved page, rows, and assignment counts are observed from one PostgreSQL `RepeatableRead` snapshot; and
- assignment counts are loaded only for the bounded page of amenity definitions.

The page renders the tenant-wide total from the scoped count, a current row range, and accessible previous/next navigation. It never loads the complete amenity catalog merely to render the management table.

## Assignment catalog

Property and room-type assignment forms still need the full set of currently assignable definitions so they can exclude already-assigned amenities. `listHospitalityAmenities` therefore remains a narrow complete-read boundary for those forms, but it now reads only `ACTIVE` amenities and fails closed above 1,000 rows rather than silently materializing an unbounded tenant collection.

The complete catalog uses deterministic name + ID ordering. It is not the management-directory API and must not be reused for new large collection screens.

## Assignment collections

Existing property and room-type amenity assignments are also complete-read inputs to the assignment forms. Those relationship queries are tenant- and parent-scoped, deterministically ordered, and fail closed above 1,000 assignments per parent scope. This keeps availability calculations exact without allowing an accidental unbounded read.

If a real tenant reaches one of the complete-read ceilings, SF should add search/paginated assignment selection as a separate product workflow rather than truncate authority silently.

## Security and lifecycle

- Browser filtering never establishes tenant ownership.
- Service reads repeat `inventory:read` authorization.
- Repository queries repeat tenant and parent identifiers.
- Archived definitions remain visible in the paginated management directory but are excluded from assignment choices.
- Amenity archival still requires all property and room-type assignments to be removed first.

This advances the platform-wide pagination invariant for hospitality inventory without claiming that every future collection is permanently complete.
