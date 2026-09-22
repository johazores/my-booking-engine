# Stripe Checkout session authority

## Purpose

Stripe Checkout Session creation returns customer redirect authority as well as provider identifiers. SF treats that response as untrusted provider input until the created Session is bound back to the exact booking or commercial amendment that requested it.

This boundary lives in `src/server/payments/stripe-checkout-provider.ts` and applies before a Checkout URL can be returned to a public customer or staff workflow. Signed Checkout callbacks reuse the same ownership model before provider evidence can finalize or expire tracked payment state.

## Created Session binding

A successful create response must agree with the request on all authority-bearing fields that SF sent to Stripe:

- the object must be a Checkout Session in `payment` mode;
- `client_reference_id` must equal the requested booking ID;
- `metadata.sf_organization_id` and `metadata.sf_booking_id` must equal the requested tenant and booking;
- normal booking Checkout must not gain commercial-amendment metadata;
- commercial-amendment Checkout must return the exact expected purpose and amendment ID;
- `expires_at` must equal the 30-minute expiry SF requested rather than extending or shortening the commercial payment window;
- amount and currency must still exactly match the requested money.

Any disagreement is retryable `UNKNOWN` provider evidence. SF does not persist the mismatched Session or redirect a customer to it.

## Signed callback binding

A valid Stripe webhook signature authenticates the payload source but does not replace SF's persisted commercial ownership checks. Before a tracked public booking `checkout.session.completed` or `checkout.session.expired` event can update payment/session/booking state, SF requires the callback Session to preserve:

- `mode=payment`;
- the exact booking `client_reference_id`;
- no commercial-amendment context for a normal booking payment;
- the exact persisted Checkout expiry;
- the already enforced tenant/booking metadata, provider Session reference, amount, and currency.

Commercial-amendment charge and recovery callbacks use the same normalized parser and require payment mode, a booking-matching client reference, a valid expiry, and the exact expected purpose/amendment ID. This keeps create authority and signed callback authority aligned instead of reparsing amendment metadata through a separate path.

Mismatched signed evidence fails closed and is not allowed to settle payment, expire a tracked Session, or cancel booking inventory.

## Redirect target boundary

The current SF integration supports Stripe's default hosted Checkout URL only. The returned URL must use HTTPS on `checkout.stripe.com`, contain no URL credentials or alternate port, remain within the existing 4,096-character bound, and end in the exact returned Checkout Session ID as its final non-empty path segment. A URL for another Session, a lookalike hostname, or an unrelated HTTPS origin fails closed.

Stripe supports custom Checkout domains, but SF does not currently model a tenant-owned Stripe Checkout custom domain or verification state. Custom Checkout domains are therefore intentionally unsupported rather than implicitly trusting any HTTPS hostname returned by a provider response. Supporting them later requires an explicit tenant/provider configuration and verification contract.

The Checkout URL is navigation authority only. It never proves payment. Signed Stripe callbacks and explicit provider reconciliation remain the payment-truth boundaries, and both are still subject to SF-owned operation binding before commercial state changes.

## Provider reconciliation binding

Explicit Checkout retrieval is also treated as external provider evidence rather than trusted just because the requested Session ID matches. Before SF returns a retrieved Session snapshot to commercial-amendment reconciliation, the provider response must still be a `payment` Session, its `client_reference_id` must equal the normalized booking ID carried in SF metadata, and `expires_at` must remain a valid provider timestamp. Existing reconciliation then separately requires the exact tenant, booking, amendment, purpose, Session reference, amount, currency, and settlement state.

This prevents a same-ID response with drifted operation authority from becoming polling/reconciliation truth. Commercial amendment flows do not currently persist a dedicated Checkout expiry column, so polling requires a valid expiry but does not claim an exact persisted-expiry comparison there; the public booking webhook path can and does compare against `PaymentCheckoutSession.expiresAt`.

## Validation

`src/server/payments/stripe-checkout-provider.test.ts` covers exact created-Session binding, expiry authority, default hosted redirect authority, hostname/session mismatch rejection, exact money, and existing reconciliation behavior. `src/server/payments/stripe-webhook-domain.test.ts` covers signed Checkout authority normalization and normal-booking binding. The commercial-amendment Checkout webhook domain tests cover normal additional-charge and recovery Session ownership. `scripts/stripe-webhook-write-scope.test.mjs` protects the core service ordering so authority validation remains before settlement/expiry handling.

Full repository Node 24 / TypeScript 6 validation, Prisma/PostgreSQL execution, production build, and live Stripe validation remain separate environment gates. GitHub Actions are intentionally not used.
