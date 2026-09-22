# Stripe webhook tenant write scope

SF treats a signed Stripe callback as externally supplied provider truth that may drive durable commercial state. The webhook boundary therefore verifies the tenant-specific signature over the raw payload, deduplicates the provider event ID and payload hash, resolves tenant-owned booking/payment/session state, and applies mutations only inside the existing serializable transaction and advisory-lock boundary.

This review hardens the core `src/server/payments/stripe-webhook-service.ts` state machine. It does not make a browser redirect authoritative.

## Checkout Session authority

A valid Stripe signature proves that Stripe signed the payload; it does not by itself prove that every Checkout Session field still represents the SF operation being finalized. For a tracked public booking Checkout, SF therefore rebinds the signed callback to the persisted Session before completion or expiry can change commercial state.

The callback must preserve the authority-bearing fields SF established when the Session was created:

- `mode` must remain `payment`;
- `client_reference_id` must equal the tracked booking ID;
- normal booking Checkout must not carry commercial-amendment context;
- `expires_at` must exactly match the persisted `PaymentCheckoutSession.expiresAt` value created from the reviewed Stripe Session;
- tenant and booking metadata, Session reference, amount, and currency must continue to match the tenant-owned persisted records.

A mismatch is persisted as an ignored provider event and cannot mark a payment successful, expire a tracked Session, or cancel inventory. This is intentionally stricter than signature verification because signed provider data is still external commercial evidence.

The same normalized Checkout parser is used by normal commercial-amendment and recovery Checkout webhook domains. Those flows require `payment` mode, `client_reference_id` equal to the metadata booking ID, a valid provider expiry, and their exact commercial purpose/amendment ID. They no longer reparse the raw JSON independently for amendment ownership.

## Final-write invariants

After the webhook has selected a tenant-owned resource and validated provider state, the final Prisma mutation repeats the validated ownership and lifecycle evidence instead of relying only on an earlier scoped read.

Checkout Session mutations retain:

- checkout session ID and `organizationId`;
- booking and payment-transaction identity;
- Stripe provider code and persisted Checkout Session reference;
- the expected `OPEN` lifecycle before completion or expiry.

Checkout payment settlement retains the transaction ID, tenant, booking, Stripe provider, `CAPTURE` kind, previously observed status/reference, currency, and exact integer-minor amount. The related booking update retains the tenant, `CONFIRMED` lifecycle, previously observed payment state, currency, and authoritative total.

Checkout expiry cancellation repeats the same payment ownership/provider/money evidence after the availability lock and re-read. The booking cancellation repeats the locked confirmed/payment lifecycle plus tenant and authoritative money evidence, so an ID-only mutation cannot silently ignore a state change observed after the earlier validation.

Refund callbacks retain the refund transaction ID, tenant, booking, Stripe provider, `REFUND` kind, expected `PENDING` state, persisted refund/source references, currency, and exact amount. Successful refund booking-state changes retain the same confirmed booking, prior payment state, currency, and total used by the allocation/reconciliation decision.

PaymentIntent callbacks retain the selected pending transaction ID, tenant, booking, provider, payment kind, pending lifecycle, persisted provider reference, currency, and exact amount. The booking payment-state transition repeats the confirmed lifecycle and prior payment state.

These predicates are defense in depth. They do not replace signature verification, provider event idempotency, payload-hash conflict detection, exact provider-reference/money checks, settlement derivation, serializable transactions, advisory locks, or Stripe provider adapters.

## Similar-pattern sweep and scope boundary

The core webhook service was swept for `PaymentTransaction`, `PaymentCheckoutSession`, and `HospitalityBooking` updates that previously wrote by row ID after a tenant-scoped read. All high-confidence occurrences in this state machine are covered by this contract.

The same Checkout authority concern was swept through the commercial-amendment webhook parsers for both charge and recovery flows. Their existing amendment-owned payment lifecycles, signed-event promotion, immutable amendment snapshots, apply/compensation semantics, and final serializable writes remain unchanged; this pass only centralizes and tightens the provider Session ownership evidence they accept. Initial authorization/capture/refund provider calls and public Checkout creation remain separate boundaries.

## Verification

`scripts/stripe-webhook-write-scope.test.mjs` is a dependency-free source contract that prevents the core webhook state machine from regressing to ID-only payment, booking, or checkout-session writes. It also verifies that raw-payload signature verification precedes durable event processing, that tracked Checkout callbacks pass through the Session-authority boundary before settlement/expiry handling, that commercial-amendment parsers use the normalized Checkout authority, and that serializable/advisory-lock behavior remains present.

`src/server/payments/stripe-webhook-domain.test.ts` covers normalized Checkout authority and exact normal-booking decisions. The commercial-amendment Checkout webhook domain tests cover exact payment mode, booking reference, expiry presence, purpose, and amendment ownership for both normal additional-charge and recovery Sessions.

Full Prisma validation/generation, repository TypeScript checking, lint, tests, production build, database-backed webhook concurrency scenarios, and live Stripe verification still require the repository-supported Node 24 environment, installed dependencies, an explicitly disposable PostgreSQL target where applicable, and provisioned provider configuration. GitHub Actions are intentionally not used.
