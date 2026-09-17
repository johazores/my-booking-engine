# Rental customer damage liability

SF records an explicit commercial liability decision only after a rental damage case has completed its operational lifecycle with retained assessment and resolution evidence.

This boundary answers whether the customer is liable and, when liable, the exact amount attributed to the retained damage case. The decision itself does not collect money, authorize a card, automatically consume a security bond, issue an invoice, or mark settlement as paid.

## Source authority

A liability decision requires the same tenant booking and damage case to remain available under authenticated server scope. The damage case must be `CLOSED`, retain an exact repair-cost estimate, and use the same currency as the confirmed rental booking. The decision also retains the source physical unit.

Browser input cannot choose tenant, booking currency, unit, damage case, idempotency key, decision time, or actor. Only one decision can exist per booking and damage case; deterministic idempotency is server-derived and PostgreSQL independently validates the authority chain.

## Outcomes and exact money

`CUSTOMER_LIABLE` requires an exact positive amount in the retained booking currency. `NO_CUSTOMER_LIABILITY` requires the customer amount to remain absent. Both outcomes require a retained reason.

Customer liability is capped by the retained repair-cost estimate. Downtime, administration, towing, loss-of-use, tax, insurance excess, penalties, or other charges are not silently folded into the amount.

## Authorization and database authority

Reads require both `booking:read` and `payment:read`; writes require both `booking:manage` and `payment:manage`. The writer serializes through the physical-unit and tenant/idempotency locks and repeats authenticated tenant/resource scope.

`RentalDamageLiabilityDecision` is append-only. PostgreSQL rejects update/delete, validates closed damage-case authority, currency, amount/outcome shape and deterministic idempotency, then authors chronology with `clock_timestamp()`. The row also carries a composite `(bookingId, organizationId)` foreign key directly to `RentalBooking`, so its denormalized booking identity cannot drift outside the retained tenant booking even if a write bypasses application code.

## Settlement boundary

Customer liability remains distinct from settlement. Booking-price settlement stays in `RentalPaymentTransaction`. A customer-liable decision can then be resolved through either the existing full-value manual/offline `RentalDamageSettlementTransaction` path or the explicit exact-match `RentalSecurityBondForfeiture` path.

Bond forfeiture is not automatic: it requires a previously collected bond, retained return custody evidence, exact equality between bond and liability amount/currency, no separate damage settlement evidence, dual booking/payment management permission, and explicit staff confirmation. PostgreSQL serializes both settlement paths so the same liability cannot be collected twice.

Partial bond offsets, excess-bond remainder handling, undersecured liability allocation, card/provider-backed collection, split tenders, and automated collection remain future commercial contracts.

## Staff workflow

Actors who can read booking and payment evidence see the customer-liability decision after the operational damage case is closed. Authorized staff can record exactly one decision; after persistence it becomes read-only.

A customer-liable decision exposes damage settlement evidence. When an eligible collected bond exactly matches that liability, the separate security-bond workspace may also expose the explicit `FORFEIT` action. Once forfeited, the damage settlement surface shows `Settled by bond` and does not expose a separate payment action.

## Validation

- `src/server/bookings/rental-damage-liability-domain.test.ts` covers outcome normalization, exact money, the retained-estimate cap, no-liability rules, and invalid source evidence.
- `scripts/rental-damage-liability-source-contract.test.mjs` protects tenant scoping, dual permissions, serialization, closed damage authority, append-only PostgreSQL checks, database time authority, and staff wiring.
- `scripts/rental-commercial-booking-integrity-source-contract.test.mjs` protects the direct tenant-owned booking foreign key used by retained damage liability evidence.
- `src/server/payments/rental-damage-settlement-domain.test.ts` protects the manual/offline settlement state machine.
- `src/server/payments/rental-security-bond-domain.test.ts` and `scripts/rental-security-bond-forfeiture-source-contract.test.mjs` protect the explicit exact-match bond alternative and double-settlement guards.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Migration/trigger verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
