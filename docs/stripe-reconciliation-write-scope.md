# Stripe reconciliation tenant write scope

SF treats provider reconciliation as a commercial state transition, not as a generic row update. A verified provider response is accepted only after the transaction, tenant, booking, provider identity, money, and current lifecycle have been revalidated. The final database mutation now repeats those same ownership and state preconditions instead of relying only on the preceding tenant-scoped read.

## Covered boundaries

This focused contract covers the authenticated staff reconciliation services:

- `src/server/payments/stripe-reconciliation-service.ts` for Stripe authorization/capture reconciliation.
- `src/server/payments/stripe-refund-reconciliation-service.ts` for Stripe refund reconciliation.

Both services already require server-side `payment:manage`, resolve the payment transaction inside the requested organization, retrieve provider truth through the Stripe adapter, and run final persistence inside a serializable transaction with the existing organization/booking payment locks.

For authorization/capture reconciliation, the final `PaymentTransaction` update now retains the transaction ID, `organizationId`, booking ID, Stripe provider code, payment kind, expected `PENDING` state, provider reference, currency, and exact minor-unit amount. When booking payment state changes, the booking update also retains the organization, confirmed booking lifecycle, previously observed payment state, currency, and authoritative total.

For refund reconciliation, the final `PaymentTransaction` update additionally retains `REFUND` kind and the persisted settlement-source provider reference. The booking state transition repeats the same tenant, confirmed lifecycle, prior payment state, currency, and total that were used to validate the authoritative refund allocation.

## Why this is separate from ordinary tenant CRUD

Reconciliation can convert external provider truth into durable commercial state. Tenant ownership alone is not enough. These writes must preserve:

- provider identity and provider-reference matching;
- exact integer-minor currency/amount evidence;
- refund settlement-source allocation;
- idempotent persisted ledger identity;
- booking/payment lifecycle rules;
- serializable transaction and advisory-lock behavior;
- provider capability and credential boundaries;
- audit history without weakening secret/card-data rules.

The added write predicates are defense in depth. They do not replace the existing reconciliation checks, provider adapters, locks, state derivation, or audit events.

## Boundaries intentionally not claimed here

This contract does not claim the signed Stripe webhook state machine, public Checkout capability flow, initial authorization/capture/refund provider calls, commercial-amendment settlement flows, tax invoices, adjustment notes, or supplier writes. Those paths have different trust, idempotency, recovery, and lifecycle contracts and require their own focused review rather than mechanical predicate changes.

## Verification

`scripts/stripe-reconciliation-write-scope.test.mjs` is a dependency-free source contract that checks both reconciliation services retain tenant, provider, money, and expected lifecycle scope at their final payment and booking mutations. It also checks this documented boundary remains explicit.

Full Prisma validation/generation, TypeScript checking, lint, build, migration/drift execution, PostgreSQL integration scenarios, and live Stripe reconciliation still require the repository-supported Node 24 environment, installed dependencies, an explicitly disposable PostgreSQL target where applicable, and provisioned provider configuration. GitHub Actions are intentionally not used.
