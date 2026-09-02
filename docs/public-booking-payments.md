# Public booking Stripe Checkout

SF now has a capability-owned Stripe-hosted Checkout boundary for public hospitality bookings. It is intentionally separate from the authenticated staff authorization/capture service: public callers never receive staff authority, never choose an organization ID or booking ID, and never send raw card details through SF.

## Security and ownership

`POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` requires a valid opaque `booking:manage` capability issued by the public confirmation boundary plus a UUID-v4 public request key. The server resolves the active organization from the slug, verifies the encrypted capability against that organization, verifies the persisted `PublicBookingBookingOwnership`, and verifies the owning public principal is still unexpired before reading or mutating payment state.

The browser supplies only the capability and request key. Return URLs are derived from the same-origin request and the organization slug; callers cannot supply arbitrary success/cancel redirects. The route is same-origin protected and all responses use `Cache-Control: no-store`.

## Payment provider boundary

`StripeCheckoutProvider` owns the Stripe-specific `/v1/checkout/sessions` request. It creates a hosted card Checkout Session using the persisted booking currency and exact minor-unit total. Organization and booking metadata are attached to both the Checkout Session and resulting PaymentIntent so SF's existing signed PaymentIntent webhook can resolve the correct tenant and booking.

SF does not handle card numbers, CVCs, or browser-generated payment method references in this flow. Stripe handles payment entry and required customer authentication on the hosted Checkout page.

The provider validates the returned Checkout object, session reference, HTTPS Checkout URL, expiry, currency, and amount before returning a redirect URL. Provider errors use the existing normalized payment failure taxonomy.

## Idempotency and persistence

Public Checkout request keys are HMAC-derived into a tenant-bound `payment-checkout` namespace. The public key cannot select SF's internal payment idempotency key directly and cannot collide with hold or booking-confirmation scopes.

Before the Stripe network call, SF serializes on the established payment idempotency and booking locks and persists a `CAPTURE / PENDING` `PaymentTransaction` with an internal `sf_claim_*` provider reference. This matches the existing uncertain-outcome pattern used by staff Stripe operations. Exact retries reuse the same Stripe idempotency key; changed operations fail closed.

The existing verified Stripe PaymentIntent webhook already supports binding a pending internal capture claim to the real `pi_*` reference and deriving the authoritative booking payment state from Stripe. The public Checkout service therefore never marks a booking paid from a browser redirect or from the Checkout Session creation response.

Public payment activity is attributed through `PublicBookingAuditEvent`; no synthetic staff user is created. Definitive non-retryable Checkout creation failures mark the pending claim failed and record only the normalized failure code. Retryable/ambiguous provider failures leave the claim pending so a retry with the same request key can recover through Stripe idempotency.

## Current exposure boundary

This server/payment boundary is real, but the final public confirmation action remains intentionally closed. Public confirmation currently creates a real `CONFIRMED / UNPAID` booking, so exposing it before abandonment recovery could strand inventory when a customer leaves Checkout.

Before the final public `Book now` journey is enabled, SF still needs Checkout abandonment handling (including `checkout.session.expired` or equivalent authoritative recovery), capability-owned payment status/recovery, and safe release/cancellation of unpaid abandoned public bookings. Only after those are connected should the confirmation endpoint and customer-facing payment transition become active.

## Validation

Dependency-free tests cover tenant/scope separation for public Checkout idempotency and the Stripe Checkout adapter's authoritative money/metadata/idempotency behavior, provider-money mismatch rejection, and retryable rate-limit classification. Repository-wide Node 24 validation and disposable PostgreSQL integration execution remain required when that environment is available.
