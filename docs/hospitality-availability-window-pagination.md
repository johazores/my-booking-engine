# Hospitality availability-window collection bounds

Hospitality availability windows are tenant-owned capacity controls for one property and room type. Management-style collection reads are bounded separately from availability decisions so SF does not confuse UI/listing pagination with complete commercial capacity authority.

## Paginated collection boundary

`listHospitalityAvailabilityWindowsPage` is the bounded collection API for browsing availability-window records.

- reads require `availability:read` before database access;
- UUID inputs for organization, actor, property, and room type are validated server-side;
- count and rows repeat the exact `organizationId + propertyId + roomTypeId` scope;
- requested pages default to page 1;
- requested page size defaults to 20 and is capped at 50 inside the service boundary;
- ordering is deterministic by lifecycle status, start date, and stable ID;
- out-of-range pages clamp to the final available page; and
- the response returns `windows`, `total`, `page`, `totalPages`, and the normalized `pageSize`.

New collection screens or APIs must use the paginated boundary rather than loading the entire room-type history.

## Legacy complete read

`listHospitalityAvailabilityWindows` remains available for existing complete-read consumers. It preserves the same authorization, tenant/property/room-type scope, and deterministic ordering, but now fails closed above 1,000 records by reading at most 1,001 rows and raising `AvailabilityWindowCollectionLimitError`.

The complete reader must not silently truncate because a caller that genuinely requires complete lifecycle evidence must be told that its evidence is incomplete. If a real workflow needs more than this ceiling, it should receive an explicit cursor/paged evidence contract designed for that decision.

## Availability decision reads are different

The `HospitalityAvailabilityWindow` reads inside availability calculation, hold creation, booking rescheduling, and commercial booking modification are date-overlap decision reads. They intentionally consume all relevant active windows for the requested stay and must not be replaced with UI pagination or silently truncated results. Active windows for a room type are non-overlapping, and those reads are already tenant/property/room-type and date scoped.

The same rule applies to protected hold/allocation evidence used while creating a capacity window: commercial correctness requires complete relevant evidence under the allocation lock. Collection pagination is not authority to drop protected inventory records.

## Security and lifecycle

- Browser state never establishes tenant ownership.
- Read authorization remains server-side through `availability:read`.
- Creation and archival retain `availability:manage`, parent-resource checks, allocation locking, serializable transactions, and audit events.
- Archived windows remain visible in collection history; only active windows participate in sellable-capacity decisions.
- No provider behavior or reservation capability changes as part of this collection hardening.

This advances the platform-wide large-collection invariant without claiming that every future availability collection is permanently complete.
