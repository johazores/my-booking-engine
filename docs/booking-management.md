# Booking management

SF has an authenticated booking-management surface at `/bookings/[booking-id]` over tenant-safe booking, payment, inventory, pricing, and audit boundaries. It supports production-safe traveler editing, same-price date rescheduling, provider-aware refunds, cancellation, paginated history, zero-delta commercial edits, and explicit versioned commercial amendments for non-zero room/rate/quantity/add-on price changes.

## Security and tenant scope

The page requires a valid authenticated session and active organization context. Booking retrieval uses `getHospitalityBooking`, which requires `booking:read` and selects the booking by both booking ID and organization ID. Cross-tenant or unavailable booking identifiers therefore resolve as unavailable instead of exposing another tenant's booking data.

Payment history and receipt data continue through their existing server services and `payment:read` authorization. Refund availability and refund writes require `payment:manage`; the refund reader scopes both the booking and every candidate payment transaction by organization ID and booking ID before deciding whether an action is available. Booking audit history requires `booking:read` and scopes every count/read by organization ID, booking resource type, and booking ID. Internal Stripe `sf_claim_*` operation references are never rendered as provider references.

Cancellation, zero-delta commercial modification, rescheduling, and traveler edits use separate server services and same-origin authenticated POST boundaries. Those booking writes derive the active organization and actor from the server session and require `booking:manage`. Provider-aware refund writes require `payment:manage`. Price-changing commercial-amendment preparation, settlement/reconciliation, apply, cancellation, and recovery require both `booking:manage` and `payment:manage` at their server service boundaries. The browser never supplies organization ownership, current payment truth, inventory truth, persisted pricing truth, settlement source, amount, currency, provider authority, or apply readiness.

Authenticated booking API JSON responses are explicitly `no-store`, including commercial option/review and amendment state reads.

## Booking mutation serialization

Cancellation, commercial modification/amendment work, rescheduling, and traveler updates acquire the shared tenant-and-booking PostgreSQL advisory lock before reading mutable booking state. The shared key intentionally matches the established payment booking-lock namespace (`payment:<organization>:booking:<booking>`) used by manual and Stripe payment persistence. This prevents lifecycle and booking-management writes from racing payment-state persistence for the same booking while preserving concurrency across different bookings and tenants.

Operations that also change inventory acquire room-type allocation locks after the shared booking lock. Commercial changes that move between room types acquire current/target allocation locks in deterministic order. Prepared non-zero amendments reserve required target capacity through the amendment-owned hold and final apply revalidates that protection plus fresh target sellable capacity before booking mutation.

Refund and amendment settlement writes remain inside payment orchestration boundaries. Manual and Stripe services use tenant-scoped idempotency/operation identity plus booking serialization and re-read authoritative settlement state before provider I/O or persistence.

## Detail surface

The booking view presents persisted production data only: reservation lifecycle, customer and ordered traveler snapshots, room/rate details, immutable pricing, selected add-ons, paginated payment history, customer-safe receipt settlement when proven, provider-aware refund management, paginated booking audit history, commercial modification/amendment actions, date rescheduling, traveler editing, cancellation, and amendment recovery when required. Empty/loading/error/success/disabled states are explicit. Jurisdiction-specific legal invoice issuance is not presented as complete.

## Traveler modification contract

`POST /api/bookings/hospitality/[booking-id]/guests` updates only the booking-specific traveler snapshots. The reusable Customer record, room/rate selection, dates, quantity, add-ons, monetary snapshot, payment ledger, and allocation remain unchanged.

The write requires a confirmed tenant-owned booking and `booking:manage`, serializes on the shared booking-mutation advisory lock, normalizes names and optional emails through the same booking-domain rules used at confirmation, and enforces `roomType.maxOccupancy × booked quantity` plus the existing global guest safety bound. It replaces the ordered guest rows atomically inside a serializable transaction.

Traveler updates have durable idempotency through a normalized SHA-256 request fingerprint and the booking audit ledger. Exact retries return the already-applied state, an idempotency key reused for different travelers is rejected, and a stale retry after a later traveler change fails closed instead of restoring old guest data. Audit events store guest counts and request fingerprints only; traveler names and emails are never copied into audit JSON, and internal fingerprints/idempotency keys are not rendered in the booking UI.

This is intentionally a zero-commercial-delta modification. It does not rewrite price history or initiate payment activity.

## Commercial modification contract

`GET /api/bookings/hospitality/[booking-id]/modify` returns only active, tenant-owned room/rate assignments and stay-valid add-ons for the booking property. It is staff-only through `booking:manage`; IDs returned to the authenticated management UI are never treated as authority on write.

`POST /api/bookings/hospitality/[booking-id]/modify` is the direct zero-delta path for room type, rate plan, room quantity, and selected add-ons on a confirmed booking with retained allocation. The server normalizes the requested commercial terms, serializes on the shared booking lock, locks both current and target room-type allocation namespaces in deterministic order, and re-reads the tenant-owned booking before mutation.

The direct write proves all of the following inside one serializable transaction:

- the requested room/rate assignment remains active for the same tenant and property;
- current traveler count fits the requested quantity and target room occupancy;
- restrictions permit the existing stay under the requested rate/room;
- physical/window capacity, live holds, and other booking allocations leave enough target inventory;
- there is no unresolved `PENDING` or `AMBIGUOUS` authorization/capture operation;
- current transactional pricing can price the exact requested room/rate/quantity/add-on selection; and
- currency plus accommodation, tax, fee, add-on, and grand-total minor-unit amounts exactly match the persisted booking monetary snapshot.

Only after those checks does SF atomically update booking commercial identifiers/quantity/add-on selections, refresh the accepted pricing fingerprint, move/resize the retained allocation, and append a truthful `booking.commercial-modified` audit event. The payment ledger and persisted monetary amounts remain unchanged.

The audit ledger is also the durable idempotency ledger for this zero-delta path. A SHA-256 fingerprint covers canonical room, rate, quantity, and sorted add-on selections but excludes retry identity. Exact current-state retries return the applied booking, changed-payload reuse of an idempotency key conflicts, and retries after a later commercial change fail closed.

### Versioned non-zero commercial amendments

A reviewed non-zero room/rate/quantity/add-on delta does not pass through the direct mutation route. The management UI first obtains authoritative review state from `POST /api/bookings/hospitality/[booking-id]/modify/preview`. A price-changing selection can be prepared only through `POST /api/bookings/hospitality/[booking-id]/commercial-amendments` with the exact server-issued `adjustmentFingerprint` for that reviewed selection.

Preparation independently requires `booking:manage` and `payment:manage`. Under tenant+booking serialization it revalidates the confirmed tenant-owned booking, booking version/current commercial snapshot, complete reconciled settlement, supported provider, target room/rate assignment, occupancy, restrictions, authoritative current target pricing, selection/adjustment fingerprints, and target inventory. When target protection is required it creates an amendment-owned availability hold. Preparation does not alter the booking or move money.

The persisted `HospitalityBookingCommercialAmendment` freezes source booking version, before/after totals and pricing fingerprints, target commercial terms, delta direction/amount/currency, settlement provider, target protection identity, request idempotency/fingerprints, lifecycle timestamps, and status. `PaymentTransaction.commercialAmendmentId` binds adjustment-owned money to the same organization+booking+amendment tuple at the database boundary.

The authenticated amendment workspace derives its state from the persisted amendment and complete tenant-owned payment ledger. Manual settlement records only real externally completed payment/refund references. Stripe refunds are source-scoped and provider-reconciled. Stripe additional charges use customer-authorized hosted Checkout with deterministic amendment ownership and signed/polling reconciliation. Browser redirects are never settlement truth and browser input cannot choose adjustment money or settlement source.

Only server-derived `READY_TO_APPLY` can invoke final apply. `applyHospitalityBookingCommercialAmendment` revalidates booking version/current terms/current price snapshot, target selection, active hold/protection, current restrictions/inventory/pricing, adjustment identity, and complete amendment settlement inside a serializable transaction. It then updates commercial terms, price aggregates/fingerprint, allocation, booking payment state, target protection, amendment status, and audit history atomically. If provider money is authoritative but final booking/inventory apply can no longer commit safely, SF routes the amendment into the explicit recovery/compensation lifecycle rather than applying stale terms or losing settlement evidence.

Expiry never silently discards provider evidence. Prepared amendments with unresolved or successful adjustment activity remain blocking/recoverable; safe expiry/release is allowed only when payment evidence proves no money-risk remains. See `docs/booking-commercial-adjustments.md` and `docs/commercial-amendment-orchestration.md` for the provider-neutral execution and recovery contracts.

## Reschedule contract

`POST /api/bookings/hospitality/[booking-id]/reschedule` changes arrival and departure dates only. Room type, rate plan, quantity, guest snapshots, add-on selections, and payment records are not browser-editable through that operation.

The write serializes first on the shared booking-mutation advisory lock and then on the same room-type allocation lock used by availability and hold workflows. It requires a confirmed booking with retained allocation and blocks unresolved `PENDING` or `AMBIGUOUS` authorization/capture operations before applying a new date change. It then revalidates active assignment, restrictions, capacity excluding its own allocation, and complete persisted pricing. When the recalculated aggregate price snapshot remains identical it atomically updates booking/allocation dates and refreshes the accepted pricing fingerprint. Any aggregate price change fails before mutation.

Price-changing date reschedules are not silently folded into the room/rate/quantity/add-on amendment contract. If that capability is prioritized, the amendment model/review/apply contract must be deliberately extended to freeze and protect target stay dates and their inventory/pricing semantics.

The audit ledger is the persisted reschedule request ledger. Exact current-state retries succeed even if a later payment operation is in progress because they do not mutate the booking; changed-payload key reuse is rejected, and stale retries after a later reschedule fail closed.

## Refund action contract

The booking-detail refund surface is a real payment action, not a client-side ledger edit. `getBookingRefundAvailability` requires `payment:manage`, tenant-scopes the booking and complete payment history, and derives whether a refund is safe from persisted booking/payment truth.

The availability policy fails closed when the booking is not confirmed/paid, a prior refund is `PENDING` or `AMBIGUOUS`, multiple unsupported settlement sources compete, a Stripe reference is still an internal `sf_claim_*` claim, settlement money does not match the authoritative booking total, refund history exceeds the settlement, or no supported successful settlement exists. The browser receives only customer/operator-safe action state rather than provider authority.

The management action deliberately refunds the complete **remaining** refundable balance. It does not accept a browser-supplied amount. Stripe-backed bookings call the configured Stripe refund boundary. Manual/offline bookings require a real external refund reference and explicitly instruct staff to complete the external refund before recording it in SF. Both server write services revalidate authoritative payment state, tenant ownership, provider/source eligibility, remaining balance, and idempotency before mutating payment history.

The client retains one payment idempotency key across uncertain retries. Changing a manual external reference resets retry identity so a changed operation cannot accidentally reuse the prior key. A successful response refreshes server-rendered booking/payment state; a failed response leaves a visible retryable error. Destructive confirmation remains keyboard-accessible and disables competing actions while submitting.

## Cancellation contract

Cancellation is a retained `CONFIRMED -> CANCELLED` lifecycle transition, not deletion. Booking, immutable guest/price snapshots, allocation record, payment ledger, and audit history remain retained. The operation serializes first on the shared booking-mutation lock and then on the allocation lock, and safely releases inventory through the existing availability rule that ignores cancelled booking allocations.

Payment state is resolved server-side before cancellation: `UNPAID`, `FAILED`, and fully `REFUNDED` may cancel; `AUTHORIZED`, `PAID`, and `PARTIALLY_REFUNDED` are blocked until funds are resolved. The service also blocks unresolved `PENDING` or `AMBIGUOUS` authorization/capture operations and active/recovery-required commercial amendments. Retrying an already-cancelled booking is idempotent and does not create another cancellation event. The UI uses explicit destructive confirmation and server-derived blocker messaging.

## Audit history

The detail page exposes a bounded, 20-row paginated history for `hospitality-booking` audit events belonging to the active tenant and booking. Internal request fingerprints and idempotency keys used for safe replay handling are filtered from rendered payloads. Commercial amendment lifecycle operations additionally persist scoped audit evidence without provider credentials or raw card data.

## Validation coverage

Dependency-free booking-domain tests cover cancellation policy, reschedule validation/zero-delta comparison, traveler normalization/fingerprinting, commercial-modification normalization/fingerprinting/selection comparison/allocation-lock ordering, occupancy enforcement, the shared booking-mutation lock namespace, commercial-amendment execution/settlement/recovery decisions, apply consistency, Stripe amendment/recovery identity, and customer-safe receipt derivation.

The guarded PostgreSQL suite includes dedicated confirmation, cancellation, rescheduling, traveler-modification, commercial-modification, and payment/refund scenarios. Reschedule coverage includes unresolved-payment blocking and same-price pricing-fingerprint refresh. Commercial-modification coverage includes permission/tenant isolation, unresolved-payment blocking, safe zero-delta room/rate/quantity/add-on replacement, allocation movement, idempotency conflicts, current-price/capacity rejection, and stale retry protection. Commercial-amendment services additionally depend on the checked-in serializable tenant/payment/inventory boundaries documented in the dedicated amendment docs.

These PostgreSQL scenarios are checked in but are not claimed as executed in environments without the required confirmed disposable PostgreSQL target. Full repository validation remains subject to the Node 24 `npm run validate` gate.

## Remaining booking-management work

The general room type/rate plan/quantity/add-on commercial modification contract is implemented for both zero-delta and versioned non-zero adjustment cases. Remaining booking-management work should not reopen that contract without a concrete requirement.

A price-changing **date** reschedule remains intentionally blocked by the date-only same-price contract and would require an explicit extension of amendment stay/inventory semantics before it can be enabled. Jurisdiction-specific legal invoice/tax-document issuance also remains a separate commercial requirement rather than being implied by the current customer-safe payment receipt.
