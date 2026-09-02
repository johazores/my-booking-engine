# Public booking confirmation boundary

## Status

SF has a server-side customer-safe confirmation boundary for capability-owned hospitality holds. Public confirmation now creates a durable `PENDING_CONFIRMATION / UNPAID` booking rather than immediately claiming that payment has been durably started or completed.

The pending booking owns the canonical booking allocation for a bounded payment-start window. If no durable or recoverable payment operation takes over before that window expires, availability stops treating the pending allocation as protected inventory. This prevents a browser/process failure between booking creation and Stripe Checkout persistence from reserving inventory indefinitely.

Staff confirmation behavior is unchanged: authenticated staff bookings still enter the shared core as `CONFIRMED / UNPAID` immediately.

## Shared canonical transaction

`src/server/bookings/hospitality-booking-confirmation-core.ts` owns the provider-independent serializable confirmation transaction used by staff and public callers. The core locks the tenant booking idempotency key and room-type allocation boundary, revalidates the active hold/customer/occupancy/current persisted price, creates immutable booking/guest/allocation records, and consumes the hold atomically.

The core accepts an explicit initial booking state. Staff callers use the default `CONFIRMED`. The public boundary uses `PENDING_CONFIRMATION` so commercial confirmation is not reported until a durable payment recovery path exists.

## Public customer and ownership

`confirmPublicHospitalityBookingFromHold` resolves the active organization from the public slug and verifies the encrypted hold capability plus persisted `PublicBookingHoldOwnership` before creating anything.

Public confirmation requires canonical recovery email. An existing active customer with that email in the same organization is reused; archived customers are not silently reactivated. New customers are created in the same serializable transaction. Guest identity remains immutable booking-specific snapshot data.

`PublicBookingBookingOwnership` binds the booking to the same public principal and organization. Its durable `createdAt` is the source of the payment-start deadline. The public response exposes only the deadline timestamp, customer-safe booking data, and an opaque `booking:manage` capability; internal tenant, principal, booking, customer, and allocation IDs are not exposed.

## Payment-start lifecycle

The payment-start window is centralized in `src/server/bookings/public-booking-payment-window.ts` and is currently 15 minutes.

A pending public allocation remains capacity-protecting while any of these are true:

- the ownership payment-start window is still open;
- an unresolved payment claim is still inside its bounded recovery window;
- a persisted open Checkout Session exists and has not expired; or
- successful payment evidence exists.

If none apply, availability ignores that pending public allocation. The booking record remains durable history and cannot later start a fresh Checkout attempt after the window has expired. No process-local timer, background worker, or GitHub Action is required for inventory correctness.

Once Stripe Checkout is durably persisted, the same transaction promotes the booking from `PENDING_CONFIRMATION` to `CONFIRMED` and writes truthful `public-booking.confirmed` attribution. Checkout expiry/payment webhooks then own the existing abandonment/settlement lifecycle.

## Idempotency and capabilities

Browser request keys remain UUID v4 values. Hold, confirmation, and Checkout operations derive separate tenant-bound HMAC namespaces. Public confirmation also stores a SHA-256 request fingerprint covering normalized customer/contact, guests, add-ons, and reviewed pricing so changed retries fail closed.

The `booking:manage` AES-256-GCM capability is scope-separated from the hold capability and remains bound to tenant, principal, booking, scope, and expiry. Payment/recovery endpoints verify both the capability and persisted ownership.

## Audit attribution

Public booking creation writes `public-booking.payment-pending`, not `public-booking.confirmed`. It records only safe commercial state, guest count, exact-money summary, pricing fingerprint, and payment-start deadline. When Checkout becomes durable, the Checkout transaction emits the actual `public-booking.confirmed` event. Staff auditing remains separate through normal authenticated `AuditEvent` rows.

## Validation

Dependency-free tests cover the payment-start deadline and allocation-protection decision, including exact-deadline expiry, bounded unresolved-payment recovery, open Checkout protection, and successful-payment protection.

`public-hospitality-confirmation.integration.ts` is registered in the disposable PostgreSQL harness and covers tenant-bound ownership, customer create/reuse, exact retries, changed-request rejection, public-only audit attribution, pending allocation protection before the deadline, and automatic capacity release at the deadline when no payment evidence exists.

Full Prisma/database execution still requires the repository Node 24 environment and an explicitly confirmed disposable PostgreSQL target. GitHub Actions are intentionally not used.
