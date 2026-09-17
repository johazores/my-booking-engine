# Rental customer damage settlement

SF supports a narrow production settlement boundary for a retained `CUSTOMER_LIABLE` rental damage decision. The liability can be satisfied either by one real full-value manual/offline damage payment or, when an already-collected security bond exactly matches the same retained liability amount and currency, by an explicit full-value security-bond forfeiture.

This remains separate from the rental booking price and `RentalPaymentTransaction`. Neither path mutates the confirmed booking total, retained repair estimate, or append-only liability decision.

## Authority chain

A damage settlement is available only when the authenticated tenant can still resolve the same booking, damage case, and append-only `RentalDamageLiabilityDecision` with outcome `CUSTOMER_LIABLE` and a positive retained amount.

The liability decision is the amount and currency authority. The browser cannot supply tenant identity, actor identity, booking currency, liability amount, provider code, idempotency key, source payment reference, bond/liability linkage, or settlement chronology. Reads require both `booking:read` and `payment:read`; writes require both `booking:manage` and `payment:manage`.

## Manual/offline settlement evidence

`RentalDamageSettlementTransaction` is append-only tenant-owned evidence linked to the immutable liability decision. The current manual contract allows at most one successful full-value `OFFLINE_PAYMENT` and one successful full-value `REFUND` attributed to that payment reference.

Only the existing `ManualPaymentProvider` adapter is enabled. Recording a row means staff confirm money was actually received or refunded outside SF. SF does not initiate a transfer, charge a card, or synthesize provider success.

Every transaction stores deterministic idempotency and a versioned request fingerprint. PostgreSQL independently requires exact liability amount/currency, source attribution, successful manual evidence, database-authored chronology, and append-only retention.

## Security-bond forfeiture alternative

`RentalSecurityBondForfeiture` is an alternative terminal settlement authority, not a damage payment transaction. It is permitted only when a collected bond, returned-custody evidence, and the retained customer-liability decision all belong to the same tenant booking and the bond amount/currency exactly equal the liability amount/currency.

The database serializes forfeiture and damage-payment creation with a shared liability advisory lock. If any separate damage settlement evidence exists, forfeiture is rejected. If forfeiture exists, a later damage payment/refund is rejected. This prevents double collection even under concurrent direct database writes.

Partial bond offsets are intentionally unsupported. A larger or smaller bond cannot be partially applied because the current bond contract has no production-safe remainder/release allocation model.

## Staff workflow

After a customer-liable damage decision is retained, authorized readers see the `Customer damage payment` card. `UNPAID` exposes the full manual/offline payment only when the liability has not been settled by bond forfeiture; `PAID` exposes the one full refund; `REFUNDED` is read-only. If exact bond forfeiture is retained, the card displays `Settled by bond` and no separate payment action is exposed.

The dedicated security-bond workspace owns the explicit destructive forfeiture action and requires the user to type `FORFEIT` before the full collected bond can be applied.

## Deliberate boundaries

This workflow does not implement card checkout, partial damage payments, partial refunds, partial bond offsets, split tenders, invoices, chargebacks, insurance claims, repair-vendor settlement, provider-backed bond settlement, or automated collection.

Provider-backed rental damage collection must remain behind payment adapters and reconcile provider truth before it can be represented as paid.

## Validation

- `src/server/payments/rental-damage-settlement-domain.test.ts` covers unpaid/paid/refunded reconciliation and exact source evidence.
- `scripts/rental-damage-settlement-source-contract.test.mjs` protects the manual/offline settlement boundary.
- `src/server/payments/rental-security-bond-domain.test.ts` and `scripts/rental-security-bond-forfeiture-source-contract.test.mjs` protect the exact-match bond-forfeiture alternative and double-settlement database guard.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Migration/trigger verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
