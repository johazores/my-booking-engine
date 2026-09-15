# Public Stripe Checkout tenant write scope

SF public hospitality Checkout is a capability-owned payment start boundary, not an authenticated staff workflow. A caller must present the signed booking capability for the tenant, the persisted booking ownership must still belong to that public principal, the principal must still be unexpired, and the tenant booking must remain active before Stripe credentials or provider behavior are used.

This review hardens `src/server/payments/public-stripe-checkout-service.ts`. It does not make browser redirects authoritative, change Stripe provider semantics, or weaken the rule that SF never accepts raw card data.

## Final-write invariants

Public Checkout already serializes the tenant idempotency key and booking mutation boundary with PostgreSQL advisory locks and serializable transactions. The final mutations now retain the commercial evidence that was validated while those locks are held.

A non-retryable provider failure can mark an internal Checkout claim failed only when the final `PaymentTransaction` predicate still matches:

- transaction ID, `organizationId`, and booking ID;
- Stripe provider code and `CAPTURE` kind;
- expected `PENDING` state;
- the exact internal claim reference;
- currency and integer-minor amount;
- the request fingerprint used to derive that claim.

The related booking failure transition retains the same tenant and booking, requires an active pending/confirmed booking with an unpaid/failed payment lifecycle, and repeats the claim currency and amount. An earlier tenant-scoped read is therefore not the only ownership or commercial-state protection at mutation time.

After Stripe returns a Checkout Session, SF re-enters the locked persistence boundary and re-reads the claim. The claim must still be `PENDING` and its provider reference must still equal the deterministic internal claim derived from the exact request fingerprint before a `PaymentCheckoutSession` can be created. A failed, reconciled, or otherwise replaced claim cannot be rebound to a newly returned provider Session.

When the first real Checkout Session promotes a `PENDING_CONFIRMATION` booking to `CONFIRMED`, that write repeats tenant ownership, the expected booking/payment lifecycle, and the same currency and exact total represented by the payment claim.

These checks are defense in depth. They do not replace capability verification, persisted public-principal ownership, principal expiry, idempotency, booking/payment locks, provider adapters, signed webhooks, polling reconciliation, or exact money/reference validation.

## Similar-pattern sweep and scope boundary

The adjacent public payment-status reader was reviewed and remains read-only. The public Checkout route remains thin and delegates commercial authority to the service.

Authenticated Stripe authorization/capture/refund initiation is a separate staff-authorized state machine. Commercial-amendment Checkout/refund/recovery services are also separate because they own amendment-specific settlement, expiry, compensation, and apply rules. Signed core Stripe callback mutation scope is documented in `docs/stripe-webhook-write-scope.md`.

## Verification

`scripts/public-stripe-checkout-write-scope.test.mjs` is a dependency-free source contract for the public Checkout mutation boundary. It prevents regression to ID-only claim mutation, checks exact internal-claim validation before provider-session binding, verifies booking promotion retains exact money/lifecycle scope, and confirms the adjacent public status service stays read-only.

Full Prisma validation/generation, TypeScript checking, lint, repository tests, production build, database-backed concurrency scenarios, and live Stripe verification still require the repository-supported Node 24 environment, installed dependencies, an explicitly disposable PostgreSQL target where applicable, and provisioned Stripe test configuration. GitHub Actions are intentionally not used.
