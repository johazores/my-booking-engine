# Stripe commercial amendment payment write scope

This document records the defense-in-depth persistence boundary for the non-Checkout Stripe commercial-amendment payment state machines.

The reviewed scope covers:

- direct server-owned Stripe authorization and capture for additional-charge amendments;
- source-scoped Stripe refunds for refund amendments;
- authenticated provider reconciliation for those direct operations; and
- signed Stripe PaymentIntent/refund webhook finalization for amendment-owned payment transactions.

Hosted commercial-amendment Checkout has a separate reviewed write-scope contract in `docs/stripe-commercial-amendment-checkout-write-scope.md`.

## Final payment mutation contract

Authorization, capture, and refund services already validate tenant ownership, permissions, amendment identity, booking state, exact money, provider capabilities, idempotency, request fingerprints, provider references, and settlement state before a write. Those checks remain required, but they are not a substitute for retaining the same authority at the final database mutation.

Every reviewed `PaymentTransaction` update now repeats the exact server-authoritative operation identity in the Prisma `where` predicate:

- transaction ID;
- `organizationId`;
- `bookingId`;
- `commercialAmendmentId`;
- idempotency key;
- request fingerprint;
- Stripe provider code;
- transaction kind;
- expected prior status;
- expected prior provider reference;
- settlement-source provider reference, including explicit `null` for authorization/capture operations;
- currency; and
- exact minor-unit amount.

This makes a stale or unexpectedly modified row fail closed at the mutation boundary instead of relying only on a preceding tenant-scoped read and application comparison.

Direct provider calls remain behind the existing Stripe payment adapter. This hardening does not move Stripe-specific behavior into generic booking or payment code.

## Direct authorization and capture

The direct additional-charge executor continues to claim each provider operation as amendment-owned `AMBIGUOUS` evidence before external I/O. Non-retryable provider failure, provider-result persistence, and later authenticated reconciliation now all require the same exact claim identity at the final write.

Authorization/capture mutations also require `sourceProviderReference: null`. A direct charge row cannot silently change into a source-scoped operation while provider work is in flight.

The deterministic stage idempotency key, request fingerprint, advisory booking/payment/idempotency locks, serializable transactions, provider-result validation, duplicate provider-reference checks, and directly-settled capture evidence remain unchanged.

## Source-scoped refund

Refund failure cleanup, provider-result persistence, and authenticated reconciliation retain the server-selected settlement source as part of the final mutation predicate. The final write therefore cannot silently move the refund to a different captured/authorized source after allocation and provider execution.

The existing refund allocation domain remains authoritative for source selection. Provider refund behavior remains behind the Stripe adapter, and the refund fingerprint continues to bind booking, amendment, exact money, and source provider reference.

## Signed webhook finalization

The non-Checkout commercial-amendment Stripe webhook handler still starts from the previously verified webhook ledger and validates provider truth against the amendment-owned payment row under the existing webhook, booking, and payment locks.

PaymentIntent and refund webhook mutations now repeat the same exact payment identity at the final `PaymentTransaction` write. The corresponding `PaymentWebhookEvent` mutation also retains:

- webhook event ID;
- `organizationId`;
- Stripe provider code;
- Stripe provider event ID;
- event type; and
- SHA-256 payload hash.

A previously verified event therefore cannot be finalized through an ID-only ledger write if its tenant/provider/event/payload identity changes before mutation.

## Booking and amendment lifecycle

These payment services do not directly rewrite the booking commercial snapshot or promote booking payment state. Successful provider evidence remains amendment-owned. The existing commercial-amendment apply/recovery state machines decide whether the prepared terms may still be applied or whether settled money requires compensation.

This review does not claim the expired-amendment Stripe recovery/compensation state machines are covered. Their release, compensation-capture, compensation-refund, and recovery-Checkout semantics have different acceptance criteria and remain a separate production review boundary.

## Validation

`scripts/stripe-commercial-amendment-payment-write-scope.test.mjs` is a dependency-free source contract for this boundary. It guards the direct authorization/capture service, source-scoped refund service, and non-Checkout signed amendment webhook against regression to ID-only payment or webhook-event mutations while also checking the surrounding authorization, locking, provider-adapter, and lifecycle boundaries remain explicit.

Full repository validation still requires the repository-supported Node 24 toolchain, Prisma validation/generation, TypeScript, lint, tests, production build, and the guarded PostgreSQL scenarios against an explicitly disposable database target. Live Stripe validation requires provisioned non-production provider configuration.

GitHub Actions are intentionally not used for this repository; validation is local/manual and through the repository's non-Actions tooling.
