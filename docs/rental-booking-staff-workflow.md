# Rental booking staff workflow

SF now exposes the first staff-facing interaction layer for the durable rental booking foundation. The workflow deliberately stays inside the already-implemented commercial contract: staff can review an effective physical-unit hold against an active tenant customer, confirm the booking through the existing atomic writer, and read paginated rental booking history and detail. It does not invent payment, deposit, cancellation, amendment, pickup, delivery, return, or fulfillment semantics.

## Routes

- `/inventory/rentals/holds/[hold-id]` remains the staff review surface for one rental hold. When the actor has the required permissions and the hold is still effective, the page provides bounded active-customer search, runs the server-side conversion authority review for the selected customer, and only renders the confirm action when the review is ready.
- `POST /api/inventory/rentals/holds/[hold-id]/confirm` is the staff confirmation boundary. It derives the active organization and actor from the authenticated server context, derives the tenant-local idempotency key from the hold and selected customer, and passes only the route hold, selected customer, and authority fingerprint into `confirmRentalBookingFromHold`.
- `/inventory/rentals/bookings` is a tenant-scoped, paginated staff read model with lifecycle filtering.
- `/inventory/rentals/bookings/[booking-id]` renders retained customer snapshot, physical allocation, lifecycle, exact money, pricing fingerprint, conversion-authority fingerprint, and source references without adding unsupported primary actions.

All routes remain inside the authenticated SF application shell. No customer/public rental booking route is introduced by this workflow.

## Authorization and tenant scope

The list and detail services validate the organization, actor, and booking identifiers and require `booking:read` before any rental booking query. Every booking count, list, and detail lookup repeats the authenticated `organizationId`; a booking ID alone never grants access.

The hold conversion page only offers the review workflow when the actor has `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read`. The final confirmation additionally requires `availability:manage`, matching the existing writer that consumes the hold. These UI checks are usability only: `reviewRentalBookingConversionAuthority` and `confirmRentalBookingFromHold` independently enforce their permissions and tenant scope server-side.

Customer selection uses the existing tenant-scoped customer service with `ACTIVE` status and a maximum of 25 results per review page. When more customers match, staff are instructed to refine the search rather than receiving an unbounded collection.

## Confirmation authority

A browser-visible review is never write authority. The selected customer causes the server to run `reviewRentalBookingConversionAuthority`, which rechecks tenant ownership, hold effectiveness using PostgreSQL time, unit/type/location lifecycle, booked or blocked inventory, current pricing, and immutable hold pricing evidence. Only a ready review receives an authority fingerprint.

The POST route does not accept an organization ID, actor ID, amount, currency, unit, dates, pricing snapshot, or idempotency key from the browser. The route derives organization and actor identity from the authenticated context and derives `rental:<hold-id>:<customer-id>` as the stable tenant-local confirmation idempotency key. The service then reacquires serialization locks and revalidates all commercial evidence before consuming the hold and atomically creating the booking, allocation, and audit event.

A successful retry that exactly matches the already-created booking redirects to the same durable booking. Conflicts, stale authority, inactive customer/hold state, permission denial, and invalid input are rejected and return staff to the hold review rather than pretending confirmation succeeded.

## Read model

`listRentalBookings` requires `booking:read`, enforces tenant scope, caps page size at 100, and supports `ALL`, `CONFIRMED`, and `CANCELLED` lifecycle filters. The list renders the immutable customer booking snapshot rather than depending on the mutable customer profile for historical identity.

`getRentalBooking` requires `booking:read` and resolves one booking only by the authenticated tenant plus booking ID. The detail includes the retained customer relation, source hold, physical unit, unit type, operating location, and exact allocation. A missing allocation is surfaced as an integrity incident rather than silently hidden.

The staff detail explicitly states that `CONFIRMED` means physical inventory is durably committed under the reviewed price. It does not imply money was collected, a deposit was authorized, or fulfillment occurred.

## UX states

The staff workflow includes:

- permission-restricted states for booking reads and conversion review
- inactive/expired hold state with no confirmation action
- bounded customer search with empty and refine-search states
- conversion blockers for legacy pricing evidence, changed pricing, and inventory conflicts
- stale/unavailable customer or hold errors
- confirmation conflict/validation/server error feedback
- idempotent-success feedback on the durable booking detail
- empty booking history and lifecycle filters
- paginated booking history
- explicit integrity feedback when retained allocation evidence is missing

All styling reuses the existing native CSS/design-token surfaces. No UI framework or new generated styling system is introduced.

## Deliberate boundaries

This workflow does not implement or imply:

- payment collection or payment status for rental bookings
- deposits or card authorization
- tax/fee/discount calculation beyond the existing daily-rate rental price evidence
- booking cancellation, amendment, or rescheduling
- customer pickup/drop-off selection, one-way returns, delivery, or transfer pricing
- pickup, check-out, return, inspection, damage, or fulfillment lifecycle
- public/customer self-service rental booking
- notifications or external rental provider synchronization

Those require separate commercial state machines and acceptance criteria. Until they exist, the staff booking detail intentionally has no dead primary actions for them.

## Validation

`scripts/rental-booking-staff-workflow-source-contract.test.mjs` protects the tenant-scoped read boundary, bounded customer search, server-derived organization/actor/idempotency authority, conversion review wiring, staff list/detail routes, and the explicit no-fake-payment/fulfillment boundary.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
