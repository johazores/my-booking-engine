# Rental late-return assessment

SF supports an explicit post-return commercial assessment when retained rental custody evidence proves that a physical unit was returned after the booking's exclusive committed end date.

The assessment is a commercial authority boundary, not an automatic collection engine. The overdue-custody guard remains operational inventory protection while the unit is still out. Only a retained `RETURNED` event can become the source of a late-return assessment.

## Source and time authority

The assessment uses immutable pickup and return fulfillment snapshots for the physical unit and committed dates. Both events must belong to the same tenant booking and physical unit, the committed start cannot change after pickup, and return cannot predate pickup. When no custody extension occurred, pickup and return retain the same committed end. When an authorized same-unit, current-start, later-end extension occurred after pickup, the immutable pickup snapshot intentionally keeps the earlier handoff commitment while the immutable return snapshot carries the later effective committed end that was authoritative at handback. A return snapshot may therefore move the committed end later than pickup, but never earlier.

The fulfillment writer and its database guard establish that return snapshot from the current tenant-owned allocation after any supported custody extension. Late-return assessment treats the retained return end as the commercial lateness boundary instead of incorrectly requiring it to equal the historical pickup end.

Because rental `endsOn` is exclusive, returning on that local calendar date is late day 1. Each later local date adds one late day. PostgreSQL independently recomputes that rule from the retained return snapshot and booking-location IANA timezone before persistence instead of trusting browser or application-derived timing.

## Policy-driven and manual fee decisions

SF now supports append-only unit-type late-return fee policy revisions. The assessment selects the latest revision that was already effective at the retained return timestamp.

When that revision is enabled, grace and fee values are server-authoritative:

- chargeable days are late days minus the retained policy grace, never below zero;
- an assessed fee is the exact policy daily fee multiplied by chargeable days;
- the browser cannot override grace, daily fee, or calculated total;
- the assessment snapshots the exact policy revision ID and daily fee used;
- PostgreSQL independently resolves the same latest effective revision and rejects mismatched policy or money evidence.

An enabled policy is not retroactive. A revision created after the retained return time cannot price that return. If the latest applicable revision is disabled, or no revision was effective at return, the previous explicit staff contract remains available: authorized staff retain case-specific grace from 0 to 30 whole days and an exact positive fee in the booking currency.

The assessment remains exactly one of:

- `FEE_ASSESSED`: at least one chargeable day remains and a positive exact fee is retained;
- `WAIVED`: no fee amount is retained, with an explicit reason.

When a policy applies, staff can still waive the policy fee with a required reason. A return inside policy grace cannot be forced into a positive fee.

See [rental-late-return-policy.md](./rental-late-return-policy.md).

## Authorization, tenant scope, and idempotency

Assessment reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`. Every booking, fulfillment, assessment, and policy lookup repeats `organizationId`.

The writer uses the shared tenant/booking advisory lock, serializable transaction retries, and the deterministic key `rental-late-return-assessment:<bookingId>`. PostgreSQL independently requires that exact key, exact tenant booking, exact return event, same physical unit, unchanged committed start, a return committed end equal to or later than retained pickup end, booking currency, derived day counts, and—when applicable—the exact policy revision effective at return. `assessedAt` and `createdAt` are authored with `clock_timestamp()` and update/delete are rejected.

The staff booking detail surfaces late-return evidence after return and exposes the assessment form only to actors with both management permissions. Retained assessments are read-only.

## Settlement boundary

The assessment itself never moves money. A retained `FEE_ASSESSED` decision feeds the separate manual/offline late-return settlement workflow. That workflow retains payment/refund evidence without mutating this assessment or the immutable rental booking price. A `WAIVED` assessment has no settlement action.

Policy automation likewise does not initiate settlement. Provider-backed collection, automatic charging, invoicing, reminders, customer self-service, and external synchronization remain separate production contracts.

See [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Deliberate boundaries

This workflow does not extend a rental, reopen custody, shorten or lengthen live allocation, authorize a card, automatically charge a customer or security bond, create an invoice, notify the customer, or synchronize an external fleet. While custody is still open, the separate reschedule lifecycle supports only a same-unit, current-start, later-end price-neutral extension; this post-return assessment never reopens that authority. Price-changing and broader rental extensions remain separate.

Automatic fee calculation is currently unit-type scoped and versioned. It does not invent customer terms acceptance, cross-currency/global tenant fee rules, or provider-backed collection.

## Validation

`src/server/bookings/rental-late-return-domain.test.ts` covers timezone-aware late-day derivation, manual grace handling, policy-derived exact fees, browser-override rejection, and waiver rules. `src/server/bookings/rental-custody-return-snapshot-domain.test.ts` covers unchanged handback evidence, valid later-end custody extensions, and fail-closed shortened/changed custody snapshots. `scripts/rental-late-return-source-contract.test.mjs` protects the original tenant/permission/persistence boundary, `scripts/rental-late-return-policy-source-contract.test.mjs` protects policy authority, and `scripts/rental-custody-extension-return-reconciliation-source-contract.test.mjs` protects extension-aware return assessment and idempotent pickup replay semantics.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Live migration/trigger execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
