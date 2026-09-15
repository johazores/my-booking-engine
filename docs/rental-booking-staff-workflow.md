# Rental booking staff workflow

SF exposes a staff-facing interaction layer for the durable rental booking foundation. Staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the atomic writer, read paginated rental booking history/detail, and cancel a confirmed booking to release its physical inventory. The workflow still does not invent payment, deposit, amendment/rescheduling, pickup, delivery, return, or fulfillment semantics.

## Routes

- `/inventory/rentals/holds/[hold-id]` remains the staff review surface for one rental hold. When the actor has the required permissions and the hold is still effective, the page provides bounded active-customer search, runs the server-side conversion authority review for the selected customer, and only renders the confirm action when the review is ready.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` is the staff confirmation boundary. It derives the active organization and actor from the authenticated server context, derives the tenant-local idempotency key from the hold and selected customer, and passes only the route hold, selected customer, and authority fingerprint into `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is a tenant-scoped, paginated staff read model with lifecycle filtering.
- `/inventory/rentals/bookings/[booking-id]` renders retained customer snapshot, physical allocation, lifecycle, exact money, pricing fingerprint, conversion-authority fingerprint, source references, and cancellation evidence when present.
- `POST /api/inventory/rentals/bookings/[booking-id]/cancel` is the staff cancellation boundary. It derives the active tenant and actor from server authentication and calls `cancelRentalBooking`; the browser cannot submit tenant, actor, unit, dates, price, or cancellation time as authority.

All routes remain inside the authenticated SF application shell. No customer/public rental booking route is introduced by this workflow.

## Authorization and tenant scope

The list and detail services validate the organization, actor, and booking identifiers and require `booking:read` before any rental booking query. Every booking count, list, and detail lookup repeats the authenticated `organizationId`; a booking ID alone never grants access.

The hold conversion page only offers the review workflow when the actor has `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`. The final confirmation additionally requires `availability:manage`, matching the writer that consumes the hold. These UI checks are usability only: the authority review and confirmation writer independently enforce permissions and tenant scope server-side.

Cancellation requires both `booking:manage` and `availability:manage`. The action is offered only for a confirmed booking with its retained allocation, but `cancelRentalBooking` independently repeats those permissions, tenant scope, lifecycle, and allocation checks inside its serializable transaction.

Customer selection uses the existing tenant-scoped customer service with `ACTIVE` status and a maximum of 25 results per review page. When more customers match, staff are instructed to refine the search rather than receiving an unbounded collection.

## Confirmation authority

A browser-visible review is never write authority. The selected customer causes the server to run `reviewRentalBookingConversionAuthority`, which rechecks tenant ownership, hold effectiveness using PostgreSQL time, unit/type/location lifecycle, booked or blocked inventory, current pricing, and immutable hold pricing evidence. Only a ready review receives an authority fingerprint.

The confirmation POST route does not accept an organization ID, actor ID, amount, currency, unit, dates, pricing snapshot, or idempotency key from the browser. The route derives organization and actor identity from the authenticated context and derives `rental:<hold-id>:<customer-id>` as the stable tenant-local confirmation idempotency key. The service then reacquires serialization locks and revalidates all commercial evidence before consuming the hold and atomically creating the booking, allocation, and audit event.

A successful retry that exactly matches the already-created booking redirects to the same durable booking. Conflicts, stale authority, inactive customer/hold state, permission denial, and invalid input are rejected and return staff to the hold review rather than pretending confirmation succeeded.

## Cancellation authority

Cancellation is a booking lifecycle and inventory-release mutation, not a financial action. The route is same-origin/authenticated and submits no mutable commercial fields. The service acquires tenant/booking and tenant/unit advisory locks, re-reads the exact tenant booking/allocation, uses PostgreSQL time, and changes only a still-matching `CONFIRMED` record to terminal `CANCELLED`.

The allocation row remains retained. Existing rental inventory queries and database guards already ignore allocations whose parent booking is cancelled, so the physical unit/date range becomes eligible for new availability, holds, and blocks after the cancellation commits. A database lifecycle trigger uses the same unit lock and rejects reopening a cancelled booking.

A repeated cancellation is idempotent and returns the already-cancelled booking without writing a duplicate audit transition. See [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports `ALL`, `CONFIRMED`, and `CANCELLED` lifecycle filters. The list renders the immutable customer booking snapshot rather than depending on the mutable customer profile for historical identity.

`getRentalBooking` requires `booking:read` and resolves one booking only by the authenticated tenant plus booking ID. The detail includes the retained customer relation, source hold, physical unit, unit type, operating location, and exact allocation. A missing allocation is surfaced as an integrity incident rather than silently hidden and blocks the cancellation action.

The staff detail explicitly states that `CONFIRMED` means physical inventory is durably committed under the reviewed price. It does not imply money was collected, a deposit was authorized, or fulfillment occurred. A `CANCELLED` booking shows its cancellation timestamp and retained allocation as historical evidence.

## UX states

The staff workflow includes permission-restricted reads/actions, inactive/expired hold state, bounded customer search, conversion blockers, stale/unavailable customer or hold errors, confirmation conflict/validation/server feedback, idempotent confirmation feedback, empty/filterable/paginated booking history, retained-allocation integrity feedback, explicit cancellation confirmation, cancellation permission/conflict/unavailable/server errors, cancellation success, and idempotent already-cancelled feedback.

All styling reuses the existing native CSS/design-token surfaces. No UI framework or new generated styling system is introduced.

## Deliberate boundaries

This workflow does not implement or imply:

- payment collection or payment status for rental bookings
- deposits or card authorization
- tax/fee/discount calculation beyond the existing daily-rate rental price evidence
- booking amendment or rescheduling
- cancellation fees, penalties, refunds, credits, or payment-provider side effects
- customer pickup/drop-off selection, one-way returns, delivery, or transfer pricing
- pickup, check-out, return, inspection, damage, or fulfillment lifecycle
- public/customer self-service rental booking
- notifications or external rental provider synchronization

Cancellation releases SF-owned inventory only. The remaining features require separate commercial state machines and acceptance criteria, so the staff detail intentionally has no dead primary actions for them.

## Validation

`scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects the tenant-scoped read boundary, bounded customer search, server-derived organization/actor/idempotency authority, conversion review wiring, staff list/detail routes, and explicit no-fake-payment/fulfillment boundary. `scripts/rental-booking-cancellation-source-contract.test.mjs` covers the new cancellation route/action plus its terminal lifecycle and inventory-release authority.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
