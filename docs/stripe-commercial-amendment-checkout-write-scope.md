# Stripe commercial amendment Checkout write scope

This review hardens the persisted write boundary for the normal customer-authorized Stripe Checkout path used by a prepared hospitality commercial amendment. It covers the authenticated Checkout creation/status service and the signed Stripe Checkout webhook finalizer. The existing provider adapter, authorization checks, booking/payment advisory locks, serializable transactions, deterministic idempotency identity, request fingerprinting, duplicate provider-reference checks, and amendment recovery rules remain authoritative.

## Invariant

A tenant-scoped read or prior validation is not sufficient authority for the final database mutation. Every reviewed `PaymentTransaction` update repeats the exact commercial identity that was validated immediately before the write: `organizationId`, `bookingId`, `commercialAmendmentId`, idempotency identity, request fingerprint, Stripe provider, `CAPTURE` kind, expected `AMBIGUOUS` lifecycle, current provider reference, null settlement-source reference, currency, and exact minor-unit amount.

This applies when SF:

- marks an internal Checkout claim definitively failed after a non-retryable provider error;
- binds the internal amendment claim to the Stripe Checkout Session returned by the adapter;
- persists provider truth returned by authenticated status reconciliation; and
- persists provider truth received through a previously verified signed Stripe Checkout webhook.

The signed webhook event ledger is also rebound at write time to the verified organization, Stripe provider, provider event id, event type, and payload hash. A webhook callback cannot use an event id alone as mutation authority.

These predicates are defense in depth around the existing locks and state-machine validation. They do not replace transaction isolation, provider reconciliation, amendment ownership checks, exact-money validation, or duplicate provider-reference protection.

## Commercial behavior preserved

The Checkout flow still creates amendment-owned payment evidence only. A successful Checkout does not rewrite the booking commercial snapshot directly. The normal commercial-amendment apply boundary remains responsible for committing reviewed booking terms while the expired-amendment recovery boundary remains responsible for late or compensating settlement. Browser redirects are navigation only and are never payment truth.

Provider-specific behavior remains behind the existing Stripe Checkout adapter. The browser does not provide organization identity, provider authority, amount, currency, amendment ownership, or a provider settlement reference.

## Scope boundary

This focused review does not claim the separate direct Stripe authorization/capture flow, source-scoped amendment refund flow, or expired-amendment Stripe recovery state machines have been hardened by this change. Those flows have different operation identity, source-allocation, compensation, and recovery acceptance criteria and remain separate production review boundaries.

## Validation

`scripts/stripe-commercial-amendment-checkout-write-scope.test.mjs` is dependency-free and guards the reviewed source contracts against ID-only payment writes or verified-webhook-event writes. It also checks that tenant authorization, Stripe adapter use, advisory locking, serializable persistence, and the documented apply/recovery separation remain visible in the implementation.

Full repository typecheck, lint, tests, production build, Prisma validation/generation, migration/drift checks, PostgreSQL concurrency scenarios, and live Stripe verification remain mandatory before production release in the repository-required Node 24 environment with an explicitly disposable PostgreSQL target and provisioned Stripe test boundary. GitHub Actions are intentionally not used for this repository.
