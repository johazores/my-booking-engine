# Booking management

SF has an authenticated booking-management surface at `/bookings/[booking-id]` over tenant-safe booking, payment, inventory, pricing, and audit boundaries. It supports production-safe traveler editing, zero-price-delta commercial term changes, date rescheduling, provider-aware refunds, cancellation, and paginated history in addition to booking/payment detail reads.

## Security and tenant scope

The page requires a valid authenticated session and active organization context. Booking retrieval uses `getHospitalityBooking`, which requires `booking:read` and selects the booking by both booking ID and organization ID. Cross-tenant or unavailable booking identifiers therefore resolve as unavailable instead of exposing another tenant's booking data.

Payment history and receipt data continue through their existing server services and `payment:read` authorization. Refund availability and refund writes require `payment:manage`; the refund reader scopes both the booking and every candidate payment transaction by organization ID and booking ID before deciding whether an action is available. Booking audit history requires `booking:read` and scopes every count/read by organization ID, booking resource type, and booking ID. Internal Stripe `sf_claim_*` operation references are never rendered as provider references.

Cancellation, commercial modifications, rescheduling, and traveler edits use separate server services and same-origin authenticated POST boundaries. Writes derive the active organization and actor from the server session and require `booking:manage`. Payment refund POST boundaries independently derive that same server-side tenant/actor context and require `payment:manage`. The browser never supplies organization ownership, current payment truth, inventory truth, persisted pricing truth, or refund-provider authority.

Authenticated booking API JSON responses are explicitly `no-store`, including the commercial-options read used by the management form.

## Booking mutation serialization

Cancellation, commercial modification, rescheduling, and traveler updates acquire the shared tenant-and-booking PostgreSQL advisory lock before reading mutable booking state. The shared key intentionally matches the established payment booking-lock namespace (`payment:<organization>:booking:<booking>`) already used by manual and Stripe payment persistence. This prevents lifecycle and booking-management writes from racing payment-state persistence for the same booking while preserving concurrency across different bookings and tenants.

Operations that also change inventory acquire room-type allocation locks after the shared booking lock. Commercial changes that move between room types acquire both the current and target allocation locks in deterministic sorted order, preventing cross-room lock-order inversions.

Refund writes remain inside the payment orchestration boundary. Manual and Stripe refund services use tenant-scoped payment idempotency plus booking serialization and re-read authoritative settlement/refund state before persisting any new refund result.

## Detail surface

The booking view presents persisted production data only: reservation lifecycle, customer and ordered traveler snapshots, room/rate details, immutable pricing, selected add-ons, paginated payment history, receipt settlement when proven, provider-aware refund management, paginated booking audit history, commercial term modification, date rescheduling, traveler editing, and cancellation. Empty/loading/error/success states are explicit and no unavailable invoice or payment-adjustment workflow is presented as complete.

## Traveler modification contract

`POST /api/bookings/hospitality/[booking-id]/guests` updates only the booking-specific traveler snapshots. The reusable Customer record, room/rate selection, dates, quantity, add-ons, monetary snapshot, payment ledger, and allocation remain unchanged.

The write requires a confirmed tenant-owned booking and `booking:manage`, serializes on the shared booking-mutation advisory lock, normalizes names and optional emails through the same booking-domain rules used at confirmation, and enforces `roomType.maxOccupancy × booked quantity` plus the existing global guest safety bound. It replaces the ordered guest rows atomically inside a serializable transaction.

Traveler updates have durable idempotency through a normalized SHA-256 request fingerprint and the booking audit ledger. Exact retries return the already-applied state, an idempotency key reused for different travelers is rejected, and a stale retry after a later traveler change fails closed instead of restoring old guest data. Audit events store guest counts and request fingerprints only; traveler names and emails are never copied into audit JSON, and internal fingerprints/idempotency keys are not rendered in the booking UI.

This is intentionally a zero-commercial-delta modification. It does not rewrite price history or initiate payment activity.

## Commercial modification contract

`GET /api/bookings/hospitality/[booking-id]/modify` returns only active, tenant-owned room/rate assignments and stay-valid add-ons for the booking property. It is staff-only through `booking:manage`; IDs returned to the authenticated management UI are never treated as authority on write.

`POST /api/bookings/hospitality/[booking-id]/modify` can change room type, rate plan, room quantity, and selected add-ons for a confirmed booking with retained allocation. The server normalizes the requested commercial terms, serializes on the shared booking lock, locks both current and target room-type allocation namespaces in deterministic order, and re-reads the tenant-owned booking before mutation.

The write then proves all of the following inside one serializable transaction:

- the requested room/rate assignment remains active for the same tenant and property;
- current traveler count fits the requested quantity and target room occupancy;
- restrictions permit the existing stay under the requested rate/room;
- physical/window capacity, live holds, and other booking allocations leave enough target inventory;
- there is no unresolved `PENDING` or `AMBIGUOUS` authorization/capture operation;
- current transactional pricing can price the exact requested room/rate/quantity/add-on selection; and
- currency plus accommodation, tax, fee, add-on, and grand-total minor-unit amounts exactly match the persisted booking monetary snapshot.

Only after those checks does SF atomically update booking commercial identifiers/quantity/add-on selections, refresh the pricing fingerprint, move/resize the retained allocation, and append a truthful `booking.commercial-modified` audit event. The payment ledger and all persisted monetary amounts remain unchanged.

The audit ledger is also the durable idempotency ledger. A SHA-256 fingerprint covers canonical room, rate, quantity, and sorted add-on selections but excludes retry identity. Exact current-state retries return the applied booking, changed-payload reuse of an idempotency key conflicts, and retries after a later commercial change fail closed.

This path deliberately rejects every non-zero monetary delta with `price-changed`. SF does not silently charge, refund, create credit, or rewrite settled payment history. A separate versioned payment-adjustment contract is required before price-changing commercial edits can be enabled.

## Reschedule contract

`POST /api/bookings/hospitality/[booking-id]/reschedule` changes arrival and departure dates only. Room type, rate plan, quantity, guest snapshots, add-on selections, payment records, and the persisted monetary price snapshot are not browser-editable through that operation.

The write serializes first on the shared booking-mutation advisory lock and then on the same room-type allocation lock used by availability and hold workflows. It requires a confirmed booking with retained allocation and blocks unresolved `PENDING` or `AMBIGUOUS` authorization/capture operations before applying a new date change. It then revalidates active assignment, restrictions, capacity excluding its own allocation, and complete persisted pricing, and atomically updates booking/allocation dates only when every monetary field and currency remain identical. Price-changing moves fail before mutation and require an explicit payment-adjustment workflow.

The audit ledger is the persisted reschedule request ledger. Exact current-state retries succeed even if a later payment operation is in progress because they do not mutate the booking; changed-payload key reuse is rejected, and stale retries after a later reschedule fail closed.

## Refund action contract

The booking-detail refund surface is a real payment action, not a client-side ledger edit. `getBookingRefundAvailability` requires `payment:manage`, tenant-scopes the booking and complete payment history, and derives whether a refund is safe from persisted booking/payment truth.

The availability policy fails closed when the booking is not confirmed/paid, a prior refund is `PENDING` or `AMBIGUOUS`, multiple supported settlement sources compete, a Stripe reference is still an internal `sf_claim_*` claim, settlement money does not match the authoritative booking total, refund history exceeds the settlement, or no supported successful settlement exists. The browser receives only the supported provider class and formatted remaining refundable balance; source provider references are not needed as client authority.

The management action deliberately refunds the complete **remaining** refundable balance. It does not accept a browser-supplied amount, preventing stale UI state from silently choosing a different partial amount. Stripe-backed bookings call the existing configured Stripe refund boundary. Manual/offline bookings require an external refund reference and explicitly instruct staff to complete the real external refund before recording it in SF. Both server write services revalidate authoritative payment state, tenant ownership, provider/source eligibility, remaining balance, and idempotency before mutating payment history.

The client generates one payment idempotency key per attempted refund and retains that key across uncertain retries. Changing a manual external reference resets retry identity so a changed operation cannot accidentally reuse the prior key. A successful response refreshes the server-rendered booking/payment state; a failed response leaves a visible retryable error. The destructive confirmation remains keyboard-accessible and disables competing actions while submitting.

## Cancellation contract

Cancellation is a retained `CONFIRMED -> CANCELLED` lifecycle transition, not deletion. Booking, immutable guest/price snapshots, allocation record, payment ledger, and audit history remain retained. The operation serializes first on the shared booking-mutation lock and then on the allocation lock, and safely releases inventory through the existing availability rule that ignores cancelled booking allocations.

Payment state is resolved server-side before cancellation: `UNPAID`, `FAILED`, and fully `REFUNDED` may cancel; `AUTHORIZED`, `PAID`, and `PARTIALLY_REFUNDED` are blocked until funds are resolved. The service also blocks unresolved `PENDING` or `AMBIGUOUS` authorization/capture operations. Retrying an already-cancelled booking is idempotent and does not create another cancellation event. The UI uses explicit destructive confirmation and server-derived blocker messaging.

## Audit history

The detail page exposes a bounded, 20-row paginated history for `hospitality-booking` audit events belonging to the active tenant and booking. Internal request fingerprints and idempotency keys used for safe replay handling are filtered from the rendered payload. Existing event payloads remain the persisted audit source of truth.

## Validation coverage

Dependency-free booking-domain tests cover cancellation policy, reschedule validation/zero-delta comparison, traveler normalization/fingerprinting, commercial-modification normalization/fingerprinting/selection comparison/allocation-lock ordering, occupancy enforcement, and the shared booking-mutation lock namespace. Dependency-free refund-availability tests cover Stripe and manual settlement selection, remaining-balance derivation, unresolved-refund blocking, internal-claim rejection, mixed-provider ambiguity, monetary mismatch, and inconsistent over-refund history.

The guarded PostgreSQL suite includes dedicated confirmation, cancellation, rescheduling, traveler-modification, commercial-modification, and payment/refund scenarios. Reschedule coverage includes unresolved-payment blocking before a new date mutation. The commercial-modification scenario covers `booking:manage` denial, cross-tenant denial, unresolved-payment blocking, safe room/rate/quantity/add-on replacement with identical monetary components, allocation movement, exact retry, changed-payload idempotency conflicts, current-price rejection, capacity rejection, stale retry protection, and non-PII audit payloads.

These PostgreSQL scenarios are checked in but are not claimed as executed in environments without the required confirmed disposable PostgreSQL target. Full repository validation remains subject to the Node 24 `npm run validate` gate.

## Remaining booking-management work

General price-changing modification remains open. Any room type, rate plan, room quantity, add-on, date, or other commercial change that produces a non-zero price delta needs an explicit versioned amendment and payment-adjustment contract covering amount owed/refunded, provider behavior, payment-state transitions, immutable history, retries, failure/ambiguity recovery, and customer/staff presentation.

Invoice generation and jurisdiction-specific tax-document issuance remain separate commercial requirements rather than being implied by the current payment receipt foundation.
