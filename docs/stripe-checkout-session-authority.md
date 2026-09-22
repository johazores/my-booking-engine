# Stripe Checkout session authority

## Purpose

Stripe Checkout Session creation returns customer redirect authority as well as provider identifiers. SF treats that response as untrusted provider input until the created Session is bound back to the exact booking or commercial amendment that requested it.

This boundary lives in `src/server/payments/stripe-checkout-provider.ts` and applies before a Checkout URL can be returned to a public customer or staff workflow.

## Created Session binding

A successful create response must now agree with the request on all authority-bearing fields that SF sent to Stripe:

- the object must be a Checkout Session in `payment` mode;
- `client_reference_id` must equal the requested booking ID;
- `metadata.sf_organization_id` and `metadata.sf_booking_id` must equal the requested tenant and booking;
- normal booking Checkout must not gain commercial-amendment metadata;
- commercial-amendment Checkout must return the exact expected purpose and amendment ID;
- `expires_at` must equal the 30-minute expiry SF requested rather than extending or shortening the commercial payment window;
- amount and currency must still exactly match the requested money.

Any disagreement is retryable `UNKNOWN` provider evidence. SF does not persist the mismatched Session or redirect a customer to it.

## Redirect target boundary

The current SF integration supports Stripe's default hosted Checkout URL only. The returned URL must use HTTPS on `checkout.stripe.com`, contain no URL credentials or alternate port, remain within the existing 4,096-character bound, and end in the exact returned Checkout Session ID as its final non-empty path segment. A URL for another Session, a lookalike hostname, or an unrelated HTTPS origin fails closed.

Stripe supports custom Checkout domains, but SF does not currently model a tenant-owned Stripe Checkout custom domain or verification state. Custom Checkout domains are therefore intentionally unsupported rather than implicitly trusting any HTTPS hostname returned by a provider response. Supporting them later requires an explicit tenant/provider configuration and verification contract.

The Checkout URL is navigation authority only. It never proves payment. Signed Stripe callbacks and explicit provider reconciliation remain the payment-truth boundaries.

## Validation

`src/server/payments/stripe-checkout-provider.test.ts` covers exact created-Session binding, expiry authority, default hosted redirect authority, hostname/session mismatch rejection, exact money, and existing reconciliation behavior. `src/server/bookings/stripe-commercial-amendment-checkout-provider.test.ts` keeps the commercial-amendment create contract aligned with the stronger provider-response checks.

Full repository Node 24 / TypeScript 6 validation, Prisma/PostgreSQL execution, production build, and live Stripe validation remain separate environment gates. GitHub Actions are intentionally not used.
