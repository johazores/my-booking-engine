# Booking management

SF has an authenticated booking-management surface at `/bookings/[booking-id]` over tenant-safe booking, payment, and audit boundaries. It supports production-safe date rescheduling, traveler snapshot editing, cancellation, and paginated history in addition to booking/payment detail reads.

## Security and tenant scope

The page requires a valid authenticated session and active organization context. Booking retrieval uses `getHospitalityBooking`, which requires `booking:read` and selects the booking by both booking ID and organization ID. Cross-tenant or unavailable booking identifiers therefore resolve as unavailable instead of exposing another tenant's booking data.

Payment history and receipt data continue through their existing server services and `payment:read` authorization. Booking audit history requires `booking:read` and scopes every count/read by organization ID, booking resource type, and booking ID. Internal Stripe `sf_claim_*` operation references are never rendered as provider references.

Cancellation, rescheduling, and traveler edits use separate server services and same-origin authenticated POST boundaries. Writes derive the active organization and actor from the server session and require `booking:manage`. The browser never supplies organization ownership, current payment truth, inventory truth, or persisted pricing truth.

## Detail surface

The booking view presents persisted production data only: reservation lifecycle, customer and ordered traveler snapshots, room/rate details, immutable pricing, selected add-ons, paginated payment history, receipt settlement when proven, paginated booking audit history, date rescheduling, traveler editing, and cancellation. Empty states are explicit and no unavailable payment or invoice workflow is presented as complete.

## Traveler modification contract

`POST /api/bookings/hospitality/[booking-id]/guests` updates only the booking-specific traveler snapshots. The reusable Customer record, room/rate selection, dates, quantity, add-ons, monetary snapshot, payment ledger, and allocation remain unchanged.

The write requires a confirmed tenant-owned booking and `booking:manage`, serializes on a booking-specific PostgreSQL advisory lock, normalizes names and optional emails through the same booking-domain rules used at confirmation, and enforces `roomType.maxOccupancy × booked quantity` plus the existing global guest safety bound. It replaces the ordered guest rows atomically inside a serializable transaction.

Traveler updates have durable idempotency through a PII-safe SHA-256 fingerprint and the booking audit ledger. Exact retries return the already-applied state, an idempotency key reused for different travelers is rejected, and a stale retry after a later traveler change fails closed instead of restoring old guest data. Audit events store guest counts and fingerprints only; traveler names/emails are never copied into audit JSON.

This is intentionally a zero-commercial-delta modification. It does not rewrite price history or initiate payment activity.

## Reschedule contract

`POST /api/bookings/hospitality/[booking-id]/reschedule` changes arrival and departure dates only. Room type, rate plan, quantity, guest snapshots, add-on selections, payment records, and the persisted monetary price snapshot are not browser-editable through that operation.

The write serializes on a booking-specific advisory lock and the same room-type allocation lock used by availability and hold workflows. It requires a confirmed booking with retained allocation, revalidates active assignment, restrictions, capacity excluding its own allocation, and complete persisted pricing, then atomically updates booking/allocation dates only when every monetary field and currency remain identical. Price-changing moves fail before mutation and require a future explicit payment-adjustment workflow.

The audit ledger is the persisted reschedule request ledger. Exact current-state retries succeed, changed-payload key reuse is rejected, and stale retries after a later reschedule fail closed.

## Cancellation contract

Cancellation is a retained `CONFIRMED -> CANCELLED` lifecycle transition, not deletion. Booking, immutable guest/price snapshots, allocation record, payment ledger, and audit history remain retained. The operation serializes on booking plus allocation locks and safely releases inventory through the existing availability rule that ignores cancelled booking allocations.

Payment state is resolved server-side before cancellation: `UNPAID`, `FAILED`, and fully `REFUNDED` may cancel; `AUTHORIZED`, `PAID`, and `PARTIALLY_REFUNDED` are blocked until funds are resolved. Retrying an already-cancelled booking is idempotent and does not create another cancellation event. The UI uses explicit destructive confirmation and server-derived blocker messaging.

## Audit history

The detail page exposes a bounded, 20-row paginated history for `hospitality-booking` audit events belonging to the active tenant and booking. Internal request fingerprints/idempotency keys used for safe replay handling are filtered from the rendered payload. Existing event payloads remain the persisted audit source of truth.

## Validation coverage

Dependency-free booking-domain tests cover cancellation policy, reschedule validation/zero-delta comparison, traveler normalization/fingerprinting, and occupancy enforcement. The guarded PostgreSQL suites already cover confirmation, cancellation, rescheduling, tenant isolation, and related concurrency boundaries. The traveler-edit persistence path still requires dedicated disposable-PostgreSQL execution/coverage before the broad `Modify booking` acceptance item should be treated as complete.

Database execution remains required against an explicitly confirmed disposable PostgreSQL target. Full repository validation remains subject to the Node 24 `npm run validate` gate.

## Remaining booking-management work

General commercial modification remains broader than traveler edits and date-only reschedule. Room type, rate plan, room quantity, add-on edits, and any change producing a non-zero payment delta need explicit version/history and payment-adjustment contracts before UI controls are exposed.

Invoice generation and jurisdiction-specific tax-document issuance remain separate commercial requirements rather than being implied by the current payment receipt foundation.
