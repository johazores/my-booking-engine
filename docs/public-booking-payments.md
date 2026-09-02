# Public booking Stripe Checkout

SF has a capability-owned Stripe-hosted Checkout boundary for public hospitality bookings. Public callers never receive staff authority, never choose organization or booking IDs, and never send raw card data through SF.

## Security and ownership

`POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` requires the opaque `booking:manage` capability plus a UUID-v4 public request key. The server resolves the tenant from the slug, verifies encrypted capability scope, `PublicBookingBookingOwnership`, and the unexpired public principal before payment work.

Return URLs are server-derived from the same-origin request. Callers cannot supply arbitrary redirect targets. The payment status recovery endpoint also keeps the capability in the POST body rather than URL/query strings. Public payment responses expose only customer-safe state and exact money—not internal IDs, provider references, idempotency keys, credentials, or card data.

The public browser stores the short-lived booking capability and stable Checkout request key only in same-tab `sessionStorage` before leaving SF for hosted Checkout. They are never put in the Stripe return URL. On return, the browser POSTs the capability to the status boundary and clears recovery state after authoritative paid, cancelled, or expired outcomes.

## Durable confirmation-to-payment lifecycle

Public hold conversion creates `PENDING_CONFIRMATION / UNPAID`, not an immediately `CONFIRMED` booking. `PublicBookingBookingOwnership.createdAt` starts a 15-minute payment-start window.

The allocation protects inventory while that window is open. If a provider request has been claimed, bounded unresolved-payment recovery can extend protection long enough to retry the same idempotent operation. A persisted open Checkout Session protects the allocation through its provider expiry. Successful payment evidence always protects it.

If no durable/recoverable payment evidence takes over before the bounded window expires, availability stops counting the pending public allocation. A fresh Checkout start is rejected after that point. This closes the crash/browser gap without a process-local timer or scheduler.

When Stripe returns a valid hosted Session, SF persists `PaymentCheckoutSession` under the booking/payment locks. In the same transaction SF promotes `PENDING_CONFIRMATION` to `CONFIRMED`, sets `confirmedAt`, and writes the truthful `public-booking.confirmed` audit event. Existing staff bookings are unaffected and remain immediately `CONFIRMED / UNPAID` after authenticated confirmation.

## Public journey orchestration

The public booking page connects the existing production boundaries end to end:

1. server-rendered tenant branding, live inventory, and current offer pricing;
2. same-origin public hold creation using a stable UUID-v4 request key;
3. capability-owned server quote and pricing fingerprint review;
4. customer/recovery contact and primary guest collection;
5. `POST /api/public-bookings/[organization-slug]/hospitality/confirmation`, which converts only that owned hold and revalidates the reviewed pricing fingerprint;
6. immediate Stripe Checkout creation with a separate stable request key;
7. hosted provider payment;
8. same-tab return recovery through the capability-owned status endpoint; and
9. truthful completion only when authoritative provider/webhook state says the booking is paid.

If quote retrieval fails after a hold was created, the browser explicitly requests hold release. A failed cleanup request keeps the capability available and surfaces a retryable release action rather than claiming inventory was released. Customers who cancel hosted Checkout return to an authoritative status check; when the server confirms payment can safely continue, the page exposes a real resume/retry action instead of leaving the reservation stranded.

The confirmation route never accepts organization, principal, hold, booking, customer, or allocation IDs as authority. Tenant scope comes from the public slug and the encrypted hold capability plus persisted ownership.

## Payment provider boundary

`StripeCheckoutProvider` owns `/v1/checkout/sessions`. It uses the persisted booking currency and exact minor-unit total, sets organization/booking metadata on the Session and resulting PaymentIntent, and gives Stripe responsibility for hosted card entry and required customer authentication.

The adapter validates Session identity, HTTPS Checkout URL, expiry, currency, and exact amount before returning anything to the public service. Provider failures use SF's normalized payment failure taxonomy.

## Idempotency and recovery

Public hold, confirmation, and Checkout stages use separate UUID-v4 browser keys which the server HMAC-derives into tenant-bound namespaces. The browser preserves each key across uncertain retries instead of inventing a replacement request after a network failure.

Public Checkout request keys are HMAC-derived into a tenant-bound `payment-checkout` namespace. Before the network call SF serializes payment-idempotency and booking mutation locks and persists a `CAPTURE / PENDING` claim with an internal `sf_claim_*` reference.

Exact retries reuse the same Stripe idempotency key. Changed operations fail closed. A retry of a recent unresolved claim is allowed inside its bounded recovery window even if the original ownership payment-start window has just elapsed; a stale unresolved claim cannot protect inventory forever.

After Stripe creates the Session, SF persists the tenant-bound `PaymentCheckoutSession` before returning the Checkout URL. A process failure after provider creation but before persistence is recovered by retrying the same public request key: Stripe idempotency returns the same provider operation and SF attempts the durable bind again.

The payment-status boundary returns explicit customer-safe continuation guidance derived from authoritative booking, payment, and Checkout-session state. An active open Checkout or retryable pending provider-start claim can reuse the stored request key. A definitively failed payment attempt requires a fresh browser UUID so the server creates a new tenant-bound idempotency scope. Ambiguous, authorized, terminal, and expired states do not invite another Checkout attempt.

## Signed lifecycle recovery

SF parses signed `checkout.session.*` data only inside the Stripe webhook adapter boundary. Tenant/booking metadata, exact money, stored Session identity, ownership, and current payment state must agree before mutations are accepted.

`checkout.session.completed` with a complete/paid Session can bind the tracked capture operation to the real PaymentIntent, mark payment succeeded, and mark the booking paid. Browser redirects never establish payment truth.

For `checkout.session.expired`, SF only cancels/releases inventory when signed provider state, stored tenant/booking/money, payment claim state, and absence of successful/late-payment evidence all agree. If a PaymentIntent reference or successful payment evidence exists, SF preserves the booking for recovery rather than releasing inventory.

Authenticated staff cancellation uses the same booking lock order and refuses to cancel while authorization/capture is `PENDING` or `AMBIGUOUS`.

## Validation

Dependency-free payment-start tests cover deadline exclusivity and protection rules. Payment-recovery domain tests cover active unpaid continuation, open Checkout resumption, retryable pending provider-start recovery, failed-attempt restart, ambiguous-state blocking, and terminal/expiry denial. Existing Checkout adapter/webhook-domain tests cover provider money/metadata/idempotency behavior, normalized provider failures, Checkout Session parsing, and fail-closed expiry decisions.

The public confirmation PostgreSQL integration suite verifies tenant-bound ownership, idempotent confirmation, pending-allocation protection, and automatic capacity release when the payment-start lifecycle expires without evidence. Full Prisma generation/validation, disposable PostgreSQL integration execution, repository typecheck/lint, and production build still require the repository's Node 24 environment. GitHub Actions are not used.
