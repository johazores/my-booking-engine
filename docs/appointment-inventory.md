# Appointment inventory foundation

## Purpose

SF now has a production internal-inventory foundation for appointment businesses without forcing staff/service scheduling into the hospitality or tour schemas.

This scope implements tenant-owned appointment services, bookable staff resources, explicit staff-to-service eligibility, and recurring weekly working-hour schedules. It does **not** create appointment bookings, derive bookable slots, invent appointment pricing, collect customer intake forms, or integrate calendars/providers. Those require separate availability, pricing, booking, and provider contracts.

## Data model

The Prisma schema lives in `prisma/appointment-inventory.prisma` and migration `20260914130000_appointment_inventory_foundation`.

- `AppointmentService` stores a tenant-local code, name/description, duration, optional before/after buffers, and active/archive lifecycle.
- `AppointmentStaff` stores a tenant-local code, display name/description, IANA timezone, and active/archive lifecycle.
- `AppointmentStaffService` is the explicit tenant-safe eligibility relation between one staff resource and one service.
- `AppointmentSchedule` stores a recurring day-of-week and same-day minute window for one staff resource. It is configuration evidence only; it is not a hold, booking, exception calendar, or generated time slot.

Service duration is 5–1,440 minutes. Each buffer is 0–480 minutes and duration plus buffers cannot exceed one day. Schedule days are 0–6 and windows are bounded to one same day; `24:00` is accepted only as an end-of-day boundary.

Database composite foreign keys require staff/service/schedule relationships to carry the same organization. Service and staff codes are unique per organization. The application independently scopes all reads and writes by the authenticated active organization.

## Authorization and tenant isolation

Reads require `inventory:read`; mutations require `inventory:manage`. Browser route IDs and submitted service codes only select resources after server-side active-organization and permission checks.

All writes use serializable transactions and safe tenant audit events. Service assignment is idempotent: assigning the same staff/service pair again returns the existing relationship without emitting a duplicate audit event.

Cross-tenant staff/service assignment is rejected before persistence and independently blocked by composite database foreign keys.

## Service eligibility and schedules

Staff service assignment is explicit rather than inferred from UI presentation or organization type. The management UI accepts a canonical service code instead of silently loading an unbounded service catalog.

Weekly schedule creation rejects any overlapping active window for the same staff/day. Archived windows remain historical configuration evidence and no longer participate in overlap checks.

This foundation intentionally does not claim date exceptions, leave, appointment slot generation, capacity beyond a single staff resource, or booking allocation.

## Lifecycle

Services, staff, and schedules are archived rather than deleted.

- service archival requires all staff assignments to be removed first;
- staff archival requires active schedules to be archived and service assignments removed first;
- schedule archival requires explicit `ARCHIVE`;
- service/staff archival requires explicit `ARCHIVE`;
- service-assignment removal requires explicit `REMOVE`.

These dependencies prevent hidden cascade behavior and keep historical inventory decisions auditable.

## UI

Authenticated operators use:

- `/inventory/appointments` for independently paginated service and staff catalogs plus creation;
- `/inventory/appointments/[staff-id]` for independently paginated working hours and service assignments.

All growing collections use the existing inventory pagination bound (default 20, maximum 50). Initial, empty, permission-denied, validation, conflict, dependency, success, loading, error, archived, and destructive-confirmation states use the existing native SF CSS/design-token system.

There are no dead appointment booking, checkout, calendar-sync, or pricing actions.

## Validation and remaining work

Dependency-free domain tests cover service durations/buffers, staff timezone validation, service codes, schedule windows, and destructive confirmations. A source-contract suite checks tenant/database relationships, permission boundaries, bounded reads, serializable/audited writes, real route wiring, and no-fake-booking/pricing boundaries. A guarded PostgreSQL scenario is included in `npm run test:database` for permissions, Tenant A/Tenant B isolation, idempotent assignments, overlapping schedule rejection, lifecycle dependencies, and audit evidence.

Live Prisma/migration/PostgreSQL execution remains governed by the Phase 1 disposable-database gate. This implementation does not claim appointment availability, slot generation, holds, pricing, customers/intake, bookings, payments, reminders, external calendar synchronization, or staff leave/exception calendars.
