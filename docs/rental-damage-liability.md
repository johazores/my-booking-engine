# Rental customer damage liability

SF records an explicit commercial liability decision only after a rental damage case has completed its operational lifecycle with retained assessment and resolution evidence.

This boundary answers whether the customer is liable for the retained damage case and, when liable, the exact amount attributed to that decision. The decision itself does not collect money, authorize a card, forfeit a security bond, issue an invoice, or mark settlement as paid. A separate full-value manual/offline damage-settlement boundary may later record real payment/refund evidence against a retained `CUSTOMER_LIABLE` decision.

## Source authority

A liability decision requires the same tenant booking and damage case to remain available under authenticated server scope. The damage case must be `CLOSED`, retain an exact repair-cost estimate, and use the same currency as the confirmed rental booking.

The decision also retains the physical unit from the source damage case. Browser input cannot choose the tenant, booking currency, unit, damage case, idempotency key, decision time, or actor.

Only one liability decision can exist per booking and per damage case. The server derives `rental-damage-liability:<damageCaseId>` and PostgreSQL independently requires that exact idempotency key.

## Outcomes and exact money

The durable outcomes are:

- `CUSTOMER_LIABLE` — requires an exact positive customer-liability amount in the retained booking currency.
- `NO_CUSTOMER_LIABILITY` — requires the customer-liability amount to remain absent.

Both outcomes require a retained reason.

The current contract deliberately caps customer liability at the retained repair-cost estimate. Downtime, administration, towing, loss-of-use, tax, insurance excess, penalties, or other damage-related charges are not silently folded into the amount. Those need explicit future pricing and legal policy before they can become commercial evidence.

A zero or negative customer-liability amount is rejected. If staff determine there is no customer liability, they must select `NO_CUSTOMER_LIABILITY` rather than persisting a zero-value liable decision.

## Authorization and tenant isolation

Reading a customer-liability decision requires both `booking:read` and `payment:read`.

Recording the decision requires both `booking:manage` and `payment:manage`. Every service query repeats authenticated `organizationId`, booking identity, damage-case identity, and retained physical-unit scope.

The writer serializes through the existing physical-unit advisory lock and a tenant/idempotency lock, then re-reads the closed damage case and confirmed booking before accepting a decision.

## Append-only database authority

`RentalDamageLiabilityDecision` is append-only tenant-owned evidence. PostgreSQL rejects updates and deletes, independently verifies the source damage case, booking, unit, closed lifecycle, retained estimate, booking/damage currency equality, amount/outcome shape, and deterministic idempotency key, then authors `decidedAt` and `createdAt` with `clock_timestamp()`.

This prevents a direct database caller from creating customer liability from an open or merely assessed damage case, changing the retained decision later, exceeding the repair estimate, or supplying its own decision chronology.

## Staff workflow

Actors who can read both booking and payment evidence see a `Customer damage liability` card after the operational damage case is closed.

Authorized staff can record exactly one decision with outcome, reason, and—only for `CUSTOMER_LIABLE`—an exact amount. The interface shows the retained repair estimate as the upper authority boundary.

After persistence, the decision is rendered read-only with its PostgreSQL-authored timestamp. A customer-liable decision then exposes the separate damage-settlement card described in `docs/rental-damage-settlement.md`; a no-liability decision exposes no collection action.

## Settlement boundary

Customer liability remains distinct from settlement. Booking-price settlement stays in `RentalPaymentTransaction`; post-return customer-damage settlement stays in `RentalDamageSettlementTransaction` so damage collection cannot silently mutate or inflate the accepted booking price.

The enabled damage-settlement contract is intentionally narrow: one full-value real manual/offline payment and, if necessary, one full-value real manual/offline refund. It references this immutable decision, uses the existing manual provider adapter, derives idempotency server-side, retains request fingerprints, and reconciles exact source evidence before SF calls it paid or refunded.

Security-bond authorization/capture/release/forfeiture, card collection, partial damage settlement, split tenders, provider-backed damage payment, and automated collection remain future commercial contracts.

## Validation

- `src/server/bookings/rental-damage-liability-domain.test.ts` covers outcome normalization, exact money, the retained-estimate cap, no-liability amount rules, and invalid source evidence.
- `scripts/rental-damage-liability-source-contract.test.mjs` protects tenant scoping, dual booking/payment permissions, physical-unit/idempotency serialization, closed damage authority, append-only PostgreSQL checks, database time authority, and real staff UI/action wiring.
- `src/server/payments/rental-damage-settlement-domain.test.ts` and `scripts/rental-damage-settlement-source-contract.test.mjs` protect the separate manual/offline settlement boundary.
- Full repository validation remains `npm run validate` on the Node version declared in `package.json`.
- Migration/trigger verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
