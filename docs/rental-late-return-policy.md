# Rental late-return fee policy

SF supports append-only, tenant-owned late-return fee policy revisions for rental unit types. This is the production automation boundary for late-return fee math; it does not collect money automatically.

## Scope and authority

A policy belongs to one authenticated organization and one active rental unit type. Reads require `inventory:read` and `pricing:read`. Revisions require `inventory:read` and `pricing:manage`.

An enabled revision retains:

- the unit-type currency;
- 0 to 30 whole grace days;
- an exact positive daily fee in integer minor units;
- a required change reason;
- a monotonic revision number;
- database-authored effective and creation timestamps;
- the actor recorded in both the revision and audit trail.

Disabling a policy creates another append-only revision with no fee authority. Existing revisions are never edited or deleted.

## Concurrency and retries

Policy writes use a tenant-and-unit-type PostgreSQL advisory lock and a serializable transaction with bounded retries. The staff form sends the latest observed revision number as optimistic concurrency evidence.

A retry of the same immediately-applied policy is idempotent when the next retained revision exactly matches the requested values. A stale form cannot silently overwrite a newer revision.

PostgreSQL independently enforces append-only revisions, active tenant unit-type ownership, unit-type currency, sequential versions, bounded grace, positive enabled fees, disabled-policy emptiness, and database-authored timestamps.

## Which revision applies

Late-return assessment selects the latest policy revision whose `effectiveAt` is on or before the immutable retained `RETURNED.occurredAt` timestamp.

This makes policy changes non-retroactive. A policy enabled after a vehicle or other rental unit was already returned cannot be used to reprice that historical return. A later disabling revision likewise affects only later returns.

If the latest applicable revision is disabled, or no revision was effective at return, the existing explicit staff assessment contract remains available.

## Automatic fee authority

When an enabled revision applies, browser-supplied grace and fee values are not accepted. The server derives:

`chargeableDays = max(0, lateDays - policyGraceDays)`

and, when a fee is assessed:

`feeMinor = chargeableDays * policyDailyFeeMinor`

The assessment snapshots the exact policy revision ID and daily fee used. PostgreSQL independently resolves the latest revision effective at return and rejects mismatched policy IDs, grace, currency, daily fee, or calculated total.

Staff may still record an explicit waiver with a required reason. A return inside policy grace can only retain a no-fee assessment; it cannot be forced into a positive fee.

## Staff UX

Rental unit-type detail pages expose the current policy revision to users with pricing read authority. Users with `pricing:manage` can enable/update or disable policy through real server-backed forms.

Returned rental booking detail continues to expose the late-return assessment workflow. When a policy applied at return, the page shows the exact effective revision and calculated fee and removes editable grace/fee inputs. When no enabled policy applied, the case-specific manual assessment fields remain.

## Deliberate boundaries

Policy automation does not charge a card, debit a security bond, send an invoice, notify a customer, or synchronize an external fleet. Settlement remains a separate evidence boundary.

Policy is deliberately unit-type scoped so different rental products and currencies do not silently share one global fee. Customer-facing terms acceptance and public self-service remain separate future contracts.

## Validation

- `src/server/pricing/rental-late-return-policy-domain.test.ts` covers policy normalization, exact minor-unit money, disabling, version input, and equivalence.
- `src/server/bookings/rental-late-return-domain.test.ts` covers policy-derived fee calculation, waiver behavior, grace, and browser-override rejection.
- `scripts/rental-late-return-policy-source-contract.test.mjs` protects schema, PostgreSQL authority, tenant/permission scope, concurrency, UI wiring, non-retroactive policy selection, and assessment linkage.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Live trigger execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
