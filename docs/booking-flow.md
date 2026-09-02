# Booking flow

## Current hospitality flow

SF has one provider-independent hospitality booking domain shared by authenticated staff workflows and the customer-safe public booking journey. Staff and public callers have different authorization/audit boundaries but converge on the same tenant-scoped availability, pricing, hold, confirmation, and allocation rules.

## Public discovery and hold lifecycle

`/book/[organization-slug]` resolves the active tenant from the slug server-side, applies persisted tenant branding, and searches real first-party inventory, restrictions, active holds, booking allocations, and persisted pricing. The browser does not choose `organizationId`.

Anonymous hold creation is available through `POST /api/public-bookings/[organization-slug]/hospitality/holds`. It uses database-backed tenant ingress limits, tenant-derived idempotency, the canonical allocation lock/capacity calculation, a fixed 15-minute hold, durable `PublicBookingPrincipal` ownership, and separate public audit attribution. The returned hold capability is an opaque AES-256-GCM bearer credential.

The same hold route supports capability-bound release. `POST /api/public-bookings/[organization-slug]/hospitality/quote` recalculates current persisted pricing for the exact owned hold and returns only customer-safe quote fields. Public writes require the shared same-origin policy and return `Cache-Control: no-store`.

## Confirmation core

`src/server/bookings/hospitality-booking-confirmation-core.ts` owns the serializable hold-to-booking transaction. It locks the booking idempotency key and the organization/property/room-type allocation boundary, revalidates the active hold and customer, rechecks occupancy, recalculates current persisted pricing, requires the reviewed pricing fingerprint, creates the booking/guest snapshots/allocation, and consumes the hold atomically.

The authenticated staff service requires `booking:manage` before entering this core and writes normal user `AuditEvent` records. Staff confirmations enter `CONFIRMED / UNPAID` immediately.

The public service verifies the encrypted hold capability plus persisted hold ownership, creates or reuses an active tenant-local customer by canonical email, calls the same confirmation core, persists `PublicBookingBookingOwnership`, and writes only `PublicBookingAuditEvent` attribution. Public request keys use a separate HMAC namespace and a normalized request fingerprint protects customer/contact, guest, add-on, and reviewed-pricing semantics from changed retries.

Public confirmation enters `PENDING_CONFIRMATION / UNPAID` and returns a separate encrypted `booking:manage` capability. That credential is tenant/principal/booking/scope/expiry bound and is used only by the capability-owned payment/recovery boundary.

## Public confirmation-to-payment lifecycle

`POST /api/public-bookings/[organization-slug]/hospitality/confirmation` is connected to the real public UI. After a current hold quote is reviewed, the customer provides contact details and the primary guest snapshot, confirmation atomically converts the owned hold, and the browser immediately starts Stripe-hosted Checkout using a separate stable public request key.

A public booking has a bounded payment-start window. Pending public allocations protect capacity only while payment start remains legitimately recoverable: during the initial deadline, a bounded unresolved-payment retry period, an open persisted Checkout Session, or after successful payment evidence. If none apply, availability stops counting the abandoned pending allocation. No process-local timer or background job is required for inventory correctness.

When a valid Stripe Checkout Session is durably persisted under the booking/payment locks, the booking is promoted to `CONFIRMED` and the truthful `public-booking.confirmed` event is written. Stripe handles hosted card entry and required customer authentication; SF never receives raw card/CVC values through the public flow.

The browser stores the short-lived booking capability and stable Checkout request key in same-tab `sessionStorage` before leaving for Stripe. Return URLs contain only a customer-safe payment-state hint. The return page POSTs the capability to the status service and only reports payment completion when authoritative persisted/provider state says the booking is paid.

Signed Stripe PaymentIntent and Checkout Session webhooks handle final settlement and abandonment. A signed expired Checkout Session releases/cancels inventory only when tenant, booking, money, tracked Session, pending claim, and absence of late/successful payment evidence all agree. Ambiguous provider outcomes fail closed and remain recoverable rather than being guessed.

## Booking state and inventory

Hospitality bookings persist exact-money price snapshots, immutable ordered guest snapshots, selected add-ons, and a permanent booking allocation. The consumed hold no longer contributes to active-hold capacity; the booking allocation does while the booking/lifecycle rules say it should protect inventory.

Authenticated booking management uses the shared booking mutation lock so cancellation, date-only rescheduling, traveler changes, and payment-state persistence cannot race same-booking lifecycle checks. Cancellation retains commercial history and releases capacity through booking state rather than deleting allocations. Rescheduling revalidates availability/restrictions/pricing and fails closed when the commercial price snapshot would change.

## Idempotency and recovery

Hold, confirmation, and Checkout use separate public UUID-v4 request keys which are HMAC-derived into tenant-bound internal namespaces. Exact retries are safe; changed payloads conflict. The browser preserves keys across uncertain outcomes and only creates a fresh Checkout key after the server identifies a definitive failed payment attempt.

If quote retrieval fails after a hold exists, the browser attempts capability-owned release and keeps the credential when cleanup is uncertain. If Checkout cannot be opened after booking creation, the stored booking capability/request key remain the recovery authority; the customer can return to the authoritative payment-status path rather than creating another reservation.

## Validation

Dependency-free tests cover public capability/idempotency behavior, payment-start windows, recovery decisions, and provider-domain normalization. Staff booking and public hold/confirmation/payment integration tests are registered in `npm run test:database`, which also validates/deploys Prisma migrations and checks drift against an explicitly confirmed disposable PostgreSQL target.

Full repository validation requires the Node 24 toolchain. GitHub Actions are intentionally not used.