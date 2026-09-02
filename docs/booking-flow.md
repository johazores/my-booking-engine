# Booking flow

## Current hospitality flow

SF has one production hospitality booking core shared by staff and the public-booking server boundary.

### Public discovery and hold lifecycle

`/book/[organization-slug]` resolves the active tenant from the slug server-side, applies persisted tenant branding, and searches real first-party inventory, restrictions, active holds, booking allocations, and persisted pricing. The browser does not choose `organizationId`.

Anonymous hold creation is available through `POST /api/public-bookings/[organization-slug]/hospitality/holds`. It uses database-backed tenant ingress limits, tenant-derived idempotency, the canonical allocation lock/capacity calculation, a fixed 15-minute hold, durable `PublicBookingPrincipal` ownership, and separate public audit attribution. The returned hold capability is an opaque AES-256-GCM bearer credential.

The same hold route supports capability-bound release. `POST /api/public-bookings/[organization-slug]/hospitality/quote` recalculates current persisted pricing for the exact owned hold and returns only customer-safe quote fields. Public writes require the shared same-origin policy and return `Cache-Control: no-store`.

### Confirmation core

`src/server/bookings/hospitality-booking-confirmation-core.ts` owns the serializable confirmation transaction. It locks the booking idempotency key and the organization/property/room-type allocation boundary, revalidates the active hold and customer, rechecks occupancy, recalculates current persisted pricing, requires the reviewed pricing fingerprint, creates the booking/guest snapshots/allocation, and consumes the hold atomically.

The authenticated staff service still requires `booking:manage` before entering this core and writes normal user `AuditEvent` records.

The public server boundary verifies the encrypted hold capability plus persisted hold ownership, creates or reuses an active tenant-local customer by canonical email, calls the same confirmation core, persists `PublicBookingBookingOwnership`, and writes only `PublicBookingAuditEvent` attribution. Public confirmation request keys use a separate HMAC namespace and an additional request fingerprint protects customer/contact fields that are not part of the internal booking idempotency shape.

A successful public confirmation produces a separate encrypted `booking:manage` capability for the same public principal. That credential is intended for the upcoming payment/recovery lifecycle and does not expose internal organization, principal, or booking IDs.

### Booking state and inventory

Confirmed hospitality bookings persist exact-money price snapshots, immutable guest snapshots, and a booking allocation. The consumed hold no longer contributes to active-hold capacity; the non-cancelled booking allocation does. Cancellation and rescheduling continue to use the canonical allocation lock and tenant-scoped booking services.

## Public journey stopping point

Final anonymous confirmation is **not** exposed through HTTP or the public UI yet. Creating a confirmed `UNPAID` booking allocates inventory beyond the short hold window, so SF must connect real payment collection and recovery through the configured payment-provider adapter before adding a final `Book now` action. The payment path must verify the booking capability and persisted public booking ownership, preserve idempotency, and define safe failure/abandonment handling.

This prevents a half-finished public workflow from converting anonymous holds into indefinitely unpaid reservations.

## Validation

Dependency-free public capability/request tests run without a database. Staff booking and public hold/confirmation integration tests are registered in `npm run test:database`, which also validates/deploys Prisma migrations and checks drift against an explicitly confirmed disposable PostgreSQL target. GitHub Actions are intentionally not used.
