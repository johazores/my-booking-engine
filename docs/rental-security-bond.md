# Rental security bond foundation

SF supports an explicit rental security-bond contract that stays separate from the immutable rental booking price and from post-return damage-liability settlement.

The enabled scope is deliberately narrow and real: authorized staff may establish one immutable positive bond requirement before custody begins, record one full-value manual/offline collection after money was actually received outside SF, and record one full-value manual/offline release after that money was actually returned outside SF. SF does not pretend that these evidence actions move money.

## Authority and tenant scope

Reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`. Organization and actor identity come only from authenticated server context.

Every service query repeats `organizationId` plus booking/bond identity. The requirement amount is parsed against the retained booking currency; browser input cannot choose tenant, currency, actor, idempotency, provider, timestamps, or settlement amount.

Requirement, collection, and release writes serialize under the existing tenant/booking advisory lock plus bond-specific idempotency locks. Expected serialization/constraint races use the bounded rental write retry contract.

## Persisted evidence

`RentalSecurityBondRequirement` retains one immutable requirement per tenant booking:

- tenant and booking identity;
- server-derived idempotency key;
- booking currency;
- positive minor-unit amount;
- PostgreSQL-authored creation time.

`RentalSecurityBondTransaction` is append-only evidence for the real manual/offline collection and release. It retains deterministic idempotency, a SHA-256 request fingerprint, provider/reference evidence, source collection reference for release, exact currency/amount, and PostgreSQL-authored chronology.

The derived state is one of:

- `REQUIRED` — a bond is required but no collection evidence exists;
- `COLLECTED` — the full required bond is retained as collected and not released;
- `RELEASED` — the full collected bond has matching release evidence.

Any partial amount, unsupported provider/kind, duplicate collection/release, mismatched currency, bad request fingerprint, missing source attribution, or release chronology failure fails closed.

## Pickup and cancellation guards

A booking with no retained security-bond requirement preserves the existing pickup behavior.

Once a requirement exists, PostgreSQL independently blocks `PICKED_UP` evidence unless the exact full bond is actively `COLLECTED`. A merely required or already released bond cannot satisfy pickup authority.

Cancellation remains allowed when a requirement was never collected or after it was released. PostgreSQL independently blocks `CONFIRMED -> CANCELLED` while a collected bond remains unreleased. This prevents inventory release while SF still retains evidence that customer bond money is being held.

## Manual reference isolation

Manual security-bond collection/release references share the same tenant-wide rental reference namespace as booking-price settlement and damage-liability settlement. The database cross-scope guard takes one advisory lock keyed by tenant + manual reference and rejects the same real-world reference if it has already been retained in any of the three ledgers.

This prevents one bank/cash/accounting reference from being presented as evidence for multiple commercial purposes, including concurrent inserts.

## Staff workflow

The rental booking payment panel links to the dedicated security-bond workspace. The workspace exposes only actions that map to persisted production behavior:

1. optionally require a positive bond before custody;
2. record a real full manual/offline collection;
3. after collection, record a real full manual/offline release.

Each action uses authenticated same-origin form handling and returns to the persisted bond state. No placeholder action is shown for unsupported behavior.

## Deliberate boundaries

This foundation does not implement card authorization or capture, online bond checkout, partial bond collection/release, split tenders, bond forfeiture, automatic damage offset, insurance claims, chargebacks, or customer self-service.

In particular, a `CUSTOMER_LIABLE` damage decision and its separate damage-settlement ledger do not automatically consume or forfeit a collected security bond. Forfeiture/offset needs its own explicit authority, accounting semantics, double-collection protection, and audit contract before it can be production-safe.

## Validation

- `src/server/payments/rental-security-bond-domain.test.ts` covers the required/collected/released state machine, fail-closed reconciliation, and deterministic server idempotency.
- `scripts/rental-security-bond-source-contract.test.mjs` protects tenant permissions, server-derived authority, append-only database evidence, pickup/cancellation guards, cross-ledger reference isolation, real staff routes, guarded database-test registration, and the no-forfeiture/no-card boundary.
- `src/server/payments/rental-security-bond.integration.ts` is registered in the disposable-PostgreSQL runner and exercises tenant isolation, requirement idempotency, append-only evidence, pickup blocking before collection, collection replay, cross-ledger manual-reference isolation, cancellation blocking while bond money is held, release replay, and cancellation after full release.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target; this migration's triggers must be exercised there before claiming live database verification.

GitHub Actions are not required or used.
