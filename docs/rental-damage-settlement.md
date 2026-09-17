# Rental customer damage settlement

SF supports a narrow production settlement boundary for a retained `CUSTOMER_LIABLE` rental damage decision. Authorized staff can record a real full-value manual/offline damage payment and, when necessary, one real full-value manual/offline refund.

This is separate from the rental booking price and from `RentalPaymentTransaction`. It does not mutate the confirmed booking total, alter the retained repair estimate, or rewrite the append-only liability decision.

## Authority chain

A damage settlement is available only when the authenticated tenant can still resolve the same booking, damage case, and append-only `RentalDamageLiabilityDecision` with outcome `CUSTOMER_LIABLE` and a positive retained amount.

The liability decision is the amount and currency authority. The browser cannot supply tenant identity, actor identity, booking currency, liability amount, provider code, idempotency key, request fingerprint, source payment reference, or settlement chronology.

Reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`.

## Persisted settlement evidence

`RentalDamageSettlementTransaction` is append-only tenant-owned evidence linked to the immutable liability decision by `(liabilityDecisionId, organizationId)`. The current contract allows at most:

1. one successful `OFFLINE_PAYMENT` for exactly the retained customer-liability amount; and
2. one successful `REFUND` for exactly that same amount, explicitly attributed to the retained payment reference.

Only the existing `ManualPaymentProvider` adapter is enabled. Recording a row means staff confirm money was actually received or refunded outside SF. SF does not initiate a transfer, charge a card, or synthesize provider success.

Every write stores a versioned SHA-256 request fingerprint binding tenant, booking, damage case, liability decision, deterministic idempotency key, operation, provider/reference evidence, currency, and exact amount. Reads recompute this fingerprint and fail closed if retained evidence does not match.

## Database authority

PostgreSQL independently requires successful manual payment/refund evidence, the operation-specific idempotency namespace, a lowercase 64-hex request fingerprint, exact liability amount/currency, and the same tenant booking/damage/liability chain. Refunds must reference the retained successful payment and cannot predate it.

The database authors `createdAt` with `clock_timestamp()` and rejects update/delete attempts. Unique tenant/liability/kind evidence prevents a second payment or refund from being added to the narrow contract.

## Staff workflow

After a customer-liable damage decision is retained, authorized readers see a separate `Customer damage payment` card.

- `UNPAID`: authorized managers can record the full offline payment reference.
- `PAID`: authorized managers can record one full offline refund reference.
- `REFUNDED`: evidence is read-only.

The interface explicitly states that these actions record real-world offline evidence and do not move money.

## Deliberate boundaries

This workflow does not implement security-bond authorization/capture/release/forfeiture, card checkout, partial damage payments, split tenders, partial refunds, invoices, chargebacks, insurance claims, repair-vendor settlement, or automated collection.

Those require separate commercial policy and provider capabilities. Provider-backed rental damage collection must remain behind payment adapters and must reconcile provider truth before it can be represented as paid.

## Validation

- `src/server/payments/rental-damage-settlement-domain.test.ts` covers unpaid/paid/refunded reconciliation, fail-closed source/amount/chronology handling, deterministic idempotency, and request fingerprinting.
- `scripts/rental-damage-settlement-source-contract.test.mjs` protects tenant authority, dual permissions, manual-provider boundaries, exact liability settlement, append-only database checks, database time authority, and real staff route wiring.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Migration/trigger verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
