# Stripe payment initiation tenant write scope

SF authenticated Stripe authorization, capture, and refund initiation is a staff-authorized commercial boundary. The application validates tenant membership and `payment:manage`, derives exact booking money and payment/refund authority server-side, claims the operation idempotently under tenant-scoped PostgreSQL locks, calls Stripe only through the configured provider adapter, and then persists provider truth under the same commercial invariants.

This review hardens `src/server/payments/stripe-payment-service.ts` and `src/server/payments/stripe-refund-service.ts`. It does not change Stripe API behavior, invent a browser payment workflow, or weaken SF's rule that raw card data is never accepted by these services.

## Authorization and capture invariants

A non-retryable provider error can fail an internal authorization/capture claim only when the final `PaymentTransaction` mutation still matches:

- transaction ID, `organizationId`, and booking ID;
- Stripe provider code and the expected authorization/capture kind;
- `PENDING` lifecycle;
- the exact internal provider claim reference;
- currency and integer-minor amount;
- the persisted request fingerprint.

Authorization failure can move the booking to `FAILED` only while the booking remains tenant-owned, `CONFIRMED`, in an unpaid/failed payment lifecycle, and still has the same currency and authoritative total as the payment claim.

After Stripe returns provider truth, authorization and capture persistence repeats the selected transaction's tenant, booking, provider, operation kind, previously observed status/reference, exact money, and request fingerprint in the final update predicate. Related booking payment-state transitions retain tenant ownership, the `CONFIRMED` lifecycle, the previously validated payment state, currency, and total.

These predicates make state changes between the earlier read and the final write fail rather than silently overwriting a different lifecycle.

## Refund invariants

Generic Stripe refunds remain source-aware. The server derives the exact refundable settlement source and amount from the reconciled booking ledger; the browser never chooses the source transaction.

A non-retryable refund failure can fail only the still-pending internal refund claim that matches the same tenant, booking, Stripe provider, `REFUND` kind, provider/source references, exact money, and request fingerprint.

When Stripe returns the refund result, the final refund mutation repeats that same evidence before replacing the internal claim with the provider refund reference. A successful refund changes booking payment state only after the complete tenant booking ledger is reconciled again, and the booking mutation retains the confirmed lifecycle, prior payment state, currency, and authoritative total used by that decision.

## Trust and concurrency boundary

These checks are defense in depth. They do not replace:

- `payment:manage` authorization and tenant-scoped booking reads;
- tenant-scoped idempotency keys and request fingerprints;
- PostgreSQL advisory locks and serializable transactions;
- provider capability checks and Stripe adapters;
- exact provider-reference, currency, and integer-minor validation;
- settlement/refund-source derivation and reconciliation;
- audit events without credentials, card data, or other secrets.

## Similar-pattern sweep and scope boundary

Public hospitality Checkout has a separate capability-owned contract in `docs/public-stripe-checkout-write-scope.md`. Signed core Stripe callback mutations are reviewed in `docs/stripe-webhook-write-scope.md`, and authenticated polling/reconciliation is reviewed in `docs/stripe-reconciliation-write-scope.md`.

Commercial-amendment Stripe Checkout, refunds, recovery, and webhook services deliberately remain outside this focused review. They own amendment-specific pricing snapshots, expiry, inventory protection, compensation, settlement, and final-apply semantics and require their own state-machine review rather than mechanical mutation-predicate changes.

## Verification

`scripts/stripe-payment-initiation-write-scope.test.mjs` is a dependency-free source contract for the authenticated authorization/capture/refund initiation boundary. It prevents regression to ID-only transaction or booking updates in the reviewed services and verifies that permission, idempotency/locking, provider, lifecycle, money, and documentation boundaries remain explicit.

Full Prisma validation/generation, TypeScript checking, lint, repository tests, production build, database-backed payment/refund concurrency scenarios, and live Stripe verification still require the repository-supported Node 24 environment, installed dependencies, an explicitly disposable PostgreSQL target where applicable, and provisioned Stripe test configuration. GitHub Actions are intentionally not used.

## Canonical PaymentMethod reference preflight

Direct Stripe authorization uses a PaymentMethod ID as part of the tenant-owned payment request fingerprint and the outbound Stripe `payment_method` field. The adapter and both authenticated authorization paths now share a strict `pm_*` reference boundary: IDs must be exact, unpadded, case-preserving provider text and at most 160 characters. The adapter rejects malformed, whitespace-padded, non-string, or oversized references with non-retryable `INVALID_REQUEST` **before any provider request**. The service-level helper runs before authorization claim creation or fingerprinting, so a padded reference cannot silently become the same persisted operation as its trimmed counterpart.

The direct adapter regression suite covers valid boundary lengths, invalid reference forms, and zero outbound provider calls. This is preflight input validation, not proof of live Stripe acceptance or of any additional provider capability. Full Node 24, TypeScript, Prisma, PostgreSQL, lint, production build, and live Stripe verification remain separate environment gates; no GitHub Actions are used.

The commercial-amendment charge fingerprint domain also independently rejects malformed, padded, delimiter-bearing, non-string, or oversized PaymentMethod IDs when constructing durable authorization identity. This protects the pure fingerprint boundary even if a future caller bypasses the existing service preflight; it does not replace the provider adapter's outbound validation. Domain regression coverage now checks the same exact-reference and 160-character rules.

## Authorization provider-reference ownership

A Stripe PaymentIntent ID must not be reused as a second authorization transaction, even when a historical row is failed or belongs to the same booking. The final serializable authorization persistence now checks every same-tenant Stripe payment transaction kind for the exact returned reference, excluding only the claim being finalized. A legitimate authorization/capture pair can share one PaymentIntent ID, but this does not permit a new authorization to adopt that ID.

The checked-in disposable-PostgreSQL integration scenarios cover same-booking historical authorization reuse, cross-kind reuse, and cross-booking reuse. The dependency-free source contract checks that the collision query is not narrowed to one kind or only to other bookings. On collision, the unresolved claim is preserved for investigation rather than attributing money to a second operation.

This is a stricter sequential provider-identity check, not a database uniqueness constraint or a proven concurrent cross-booking reference reservation. A full concurrency-safe, cross-writer uniqueness strategy requires a separately reviewed migration and disposable-PostgreSQL validation. These integration scenarios have not been executed in the current environment because the repository Node 24 toolchain and disposable database are unavailable.
