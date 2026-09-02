# Public booking Stripe Checkout

SF has a capability-owned Stripe-hosted Checkout boundary for public hospitality bookings. Public callers never receive staff authority, never choose organization or booking IDs, and never send raw card data through SF.

## Security and ownership

`POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` requires the opaque `booking:manage` capability plus a UUID-v4 public request key. The server resolves the tenant from the slug, verifies encrypted capability scope, `PublicBookingBookingOwnership`, and the unexpired public principal before payment work.

Return URLs are server-derived from the same-origin request. Callers cannot supply arbitrary redirect targets. The payment status recovery endpoint also keeps the capability in the POST body rather than URL/query strings. Public payment responses expose only customer-safe state and exact money—not internal IDs, provider references, idempotency keys, credentials, or card data.

## Durable confirmation-to-payment lifecycle

Public hold conversion now creates `PENDING_CONFIRMATION / UNPAID`, not an immediately `CONFIRMED` booking. `PublicBookingBookingOwnership.createdAt` starts a 15-minute payment-start window.

The allocation protects inventory while that window is open. If a provider request has been claimed, bounded unresolved-payment recovery can extend protection long enough to retry the same idempotent operation. A persisted open Checkout Session protects the allocation through its provider expiry. Successful payment evidence always protects it.

If no durable/recoverable payment evidence takes over before the bounded window expires, availability stops counting the pending public allocation. A fresh Checkout start is rejected after that point. This closes the previous crash/browser gap without a process-local timer or scheduler.

When Stripe returns a valid hosted Session, SF persists `PaymentCheckoutSession` under the booking/payment locks. In the same transaction SF promotes `PENDING_CONFIRMATION` to `CONFIRMED`, sets `confirmedAt`, and writes the truthful `public-booking.confirmed` audit event. Therefore a public booking is not called confirmed until the durable provider recovery identity exists.

Existing staff bookings are unaffected and remain immediately `CONFIRMED / UNPAID` after authenticated confirmation.

## Payment provider boundary

`StripeCheckoutProvider` owns `/v1/checkout/sessions`. It uses the persisted booking currency and exact minor-unit total, sets organization/booking metadata on the Session and resulting PaymentIntent, and gives Stripe responsibility for hosted card entry and required customer authentication.

The adapter validates Session identity, HTTPS Checkout URL, expiry, currency, and exact amount before returning anything to the public service. Provider failures use SF's normalized payment failure taxonomy.

## Idempotency and recovery

Public Checkout request keys are HMAC-derived into a tenant-bound `payment-checkout` namespace. Before the network call SF serializes payment-idempotency and booking mutation locks and persists a `CAPTURE / PENDING` claim with an internal `sf_claim_*` reference.

Exact retries reuse the same Stripe idempotency key. Changed operations fail closed. A retry of a recent unresolved claim is allowed inside its bounded recovery window even if the original ownership payment-start window has just elapsed; a stale unresolved claim cannot protect inventory forever.

After Stripe creates the Session, SF persists the tenant-bound `PaymentCheckoutSession` before returning the Checkout URL. A process failure after provider creation but before persistence is recovered by retrying the same public request key: Stripe idempotency returns the same provider operation and SF attempts the durable bind again.

## Signed lifecycle recovery

SF parses signed `checkout.session.*` data only inside the Stripe webhook adapter boundary. Tenant/booking metadata, exact money, stored Session identity, ownership, and current payment state must agree before mutations are accepted.

`checkout.session.completed` with a complete/paid Session can bind the tracked capture operation to the real PaymentIntent, mark payment succeeded, and mark the booking paid. Browser redirects never establish payment truth.

For `checkout.session.expired`, SF only cancels/releases inventory when signed provider state, stored tenant/booking/money, payment claim state, and absence of successful/late-payment evidence all agree. If a PaymentIntent reference or successful payment evidence exists, SF preserves the booking for recovery rather than releasing inventory.

Authenticated staff cancellation uses the same booking lock order and refuses to cancel while authorization/capture is `PENDING` or `AMBIGUOUS`.

## Current exposure boundary

The confirmation-to-payment crash gap is now closed at the server lifecycle level. The remaining public-journey work is HTTP/UI orchestration: collect validated customer/guest data, submit confirmation, immediately start Checkout with stable request keys, handle payment-start expiry/recovery states, and present only truthful completion after signed provider settlement.

That UI/API work can now be implemented without creating indefinitely unpaid inventory reservations.

## Validation

Dependency-free payment-start tests cover deadline exclusivity and protection rules. Existing Checkout adapter/webhook-domain tests cover provider money/metadata/idempotency behavior, normalized provider failures, Checkout Session parsing, and fail-closed expiry decisions.

The public confirmation PostgreSQL integration suite now also verifies that a pending allocation protects capacity before its payment-start deadline and no longer protects capacity at the deadline when no payment evidence exists. Full Prisma generation/validation, disposable PostgreSQL integration execution, repository typecheck/lint, and production build still require the repository's Node 24 environment. GitHub Actions are not used.
