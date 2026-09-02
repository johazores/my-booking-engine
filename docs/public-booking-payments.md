# Public booking Stripe Checkout

SF has a capability-owned Stripe-hosted Checkout boundary for public hospitality bookings. It remains separate from authenticated staff authorization/capture: public callers never receive staff authority, never choose an organization ID or booking ID, and never send raw card details through SF.

## Security and ownership

`POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` requires a valid opaque `booking:manage` capability plus a UUID-v4 public request key. The server resolves the active organization from the slug, verifies the encrypted capability against that organization, verifies `PublicBookingBookingOwnership`, and verifies the owning public principal is still unexpired before reading or mutating payment state.

The browser supplies only the capability and request key. Return URLs are derived from the same-origin request and organization slug; callers cannot supply arbitrary success/cancel redirects. The route is same-origin protected and uses `Cache-Control: no-store`.

`POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout/status` provides capability-owned recovery after returning from Stripe. The capability stays in the request body instead of the URL/query string. The response contains only customer-safe booking/payment state, exact money, and normalized latest-operation state—never provider references, internal IDs, idempotency keys, credentials, or Stripe Checkout URLs.

## Payment provider boundary

`StripeCheckoutProvider` owns the Stripe-specific `/v1/checkout/sessions` request. It creates a hosted card Checkout Session using the persisted booking currency and exact minor-unit total. Organization and booking metadata are attached to both the Checkout Session and resulting PaymentIntent.

SF never handles card numbers or CVCs in this flow. Stripe owns payment entry and required customer authentication on the hosted Checkout page.

The provider validates the returned Checkout object, session reference, HTTPS Checkout URL, expiry, currency, and amount before returning a redirect URL. Provider failures use the normalized payment failure taxonomy.

## Idempotency and durable Checkout identity

Public Checkout request keys are HMAC-derived into a tenant-bound `payment-checkout` namespace. A public key cannot select SF's internal payment idempotency key or collide with hold/confirmation scopes.

Before the Stripe network call, SF serializes on the existing payment-idempotency and booking locks and persists a `CAPTURE / PENDING` `PaymentTransaction` with an internal `sf_claim_*` provider reference. Exact retries reuse the same Stripe idempotency key; changed operations fail closed.

After Stripe creates the hosted session and before SF returns the Checkout URL, SF persists a tenant-bound `PaymentCheckoutSession`. The record binds the organization, booking, public principal, payment transaction, provider session reference, expiry, and lifecycle state. Database composite foreign keys prevent a session from being attached across tenants. A process failure after Stripe creation but before persistence is recovered by retrying the same public request key: Stripe idempotency returns the same provider operation and SF attempts the durable bind again before exposing the URL.

The Checkout Session reference is deliberately stored separately from the `PaymentTransaction.providerReference`. The transaction continues to hold the internal claim until signed provider evidence establishes the actual PaymentIntent used for the settled payment.

## Signed lifecycle recovery

SF parses signed `checkout.session.*` objects only inside the Stripe webhook adapter boundary. Checkout metadata, exact currency/amount, persisted tenant ownership, and the stored Session reference must all agree before state changes are accepted.

For `checkout.session.completed` with `status=complete` and `payment_status=paid`, SF binds the tracked capture transaction to the Session's PaymentIntent, marks the payment transaction succeeded, marks the booking paid, and records the Checkout Session as completed. Browser redirects never mark a booking paid.

For `checkout.session.expired`, SF records the provider Session as expired. Automatic inventory release is intentionally stricter than the provider minimum: SF cancels the public booking only when all of the following remain true under the canonical booking and availability locks:

- the signed Session is `expired` and `unpaid`;
- the Session matches the stored tenant, booking, money, and provider reference;
- the booking is still confirmed and unpaid/failed;
- the tracked capture transaction is still a pending internal `sf_claim_*` operation;
- no successful authorization/capture exists for the booking; and
- the expired Session carries no PaymentIntent reference.

If a PaymentIntent reference or any successful payment evidence exists, SF preserves the booking for payment recovery rather than releasing inventory. This fails closed against a late-success race. The signed webhook event remains the provider audit lineage; SF does not fabricate a staff actor for provider-driven abandonment.

Checkout can accept more than one card attempt while its Session remains open. A non-settled PaymentIntent webhook associated with an open tracked Checkout Session therefore no longer fails the whole Checkout transaction; the transaction remains pending for a later attempt or authoritative Session expiry. Successful PaymentIntent reconciliation remains supported as an additional signed settlement path.

## Cancellation concurrency

Authenticated staff cancellation uses the same booking and availability lock order as payment recovery. Cancellation now also refuses to cancel a booking while an authorization/capture transaction is `PENDING`. This closes the race where a staff cancellation could previously occur after SF claimed a provider payment but before the provider outcome was known.

## Current exposure boundary

The provider abandonment dependency is now implemented, but the final public `Book now` journey remains intentionally closed. Public confirmation creates a real `CONFIRMED / UNPAID` booking before Checkout starts. A process/browser failure between confirmation and creation of the first durable Checkout Session could still strand inventory because no provider Session would exist to emit an expiry event.

The next production boundary is therefore a confirmation-to-payment orchestration that cannot leave a newly confirmed booking indefinitely reserved when Checkout is never durably started. That needs a durable booking/payment-start deadline or equivalent recoverable lifecycle—not a cancel-redirect heuristic or process-local timer. Once that gap is closed, the public confirmation API and UI can be exposed without a dead or unsafe primary action.

## Validation

Dependency-free webhook-domain coverage includes Checkout Session parsing, exact tenant/booking/money normalization, invalid provider-state rejection, PaymentIntent-reference preservation, and the fail-closed expiry decision. Existing public Checkout adapter/idempotency coverage remains applicable. The new persistence constraints and webhook state transitions require Prisma generation/validation and disposable PostgreSQL integration execution when the repository's Node 24 database environment is available.
