# Rental late-return assessment

SF supports an explicit post-return commercial assessment when retained rental custody evidence proves that a physical unit was returned after the booking's exclusive committed end date.

This is a commercial authority boundary, not an automatic fee engine. The overdue-custody guard remains operational inventory protection while the unit is still out. Only a retained `RETURNED` event can become the source of a late-return assessment.

## Source and time authority

The assessment uses immutable pickup and return fulfillment snapshots for the physical unit and committed dates. Both events must belong to the same tenant booking and physical unit, the committed start cannot change after pickup, and return cannot predate pickup. When no custody extension occurred, pickup and return retain the same committed end. When an authorized same-unit, current-start, later-end extension occurred after pickup, the immutable pickup snapshot intentionally keeps the earlier handoff commitment while the immutable return snapshot carries the later effective committed end that was authoritative at handback. A return snapshot may therefore move the committed end later than pickup, but never earlier.

The fulfillment writer and its database guard establish that return snapshot from the current tenant-owned allocation after any supported custody extension. Late-return assessment treats the retained return end as the commercial lateness boundary instead of incorrectly requiring it to equal the historical pickup end.

Because rental `endsOn` is exclusive, returning on that local calendar date is late day 1. Each later local date adds one late day. PostgreSQL independently recomputes that rule from the retained return snapshot and booking-location IANA timezone before persistence instead of trusting browser or application-derived timing.

## Grace and fee decision

Authorized staff explicitly retain a case-specific grace period from 0 to 30 whole calendar days. SF does not infer a tenant-wide late policy from mutable configuration.

The assessment is append-only and is exactly one of:

- `FEE_ASSESSED`: at least one late day remains after grace and staff retain an exact positive fee amount in the booking currency;
- `WAIVED`: no fee amount is retained, with an explicit reason.

The fee is not calculated automatically from daily rates because no production late-fee policy exists yet. The retained amount is commercial authority only and does not change the accepted rental price.

## Authorization, tenant scope, and idempotency

Reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`. Every booking, fulfillment, and assessment lookup repeats `organizationId`.

The writer uses the shared tenant/booking advisory lock, serializable transaction retries, and the deterministic key `rental-late-return-assessment:<bookingId>`. PostgreSQL independently requires that exact key, exact tenant booking, exact return event, same physical unit, unchanged committed start, a return committed end that is equal to or later than the retained pickup end, booking currency, and derived day counts. `assessedAt` and `createdAt` are authored with `clock_timestamp()` and update/delete are rejected.

The staff booking detail surfaces late-return evidence after return and exposes the assessment form only to actors with both management permissions. Retained assessments are read-only.

## Settlement boundary

The assessment itself never moves money. A retained `FEE_ASSESSED` decision can now feed the separate full-value manual/offline late-return settlement workflow. That workflow retains payment/refund evidence without mutating this assessment or the immutable rental booking price. A `WAIVED` assessment has no settlement action.

See [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Deliberate boundaries

This workflow does not extend a rental, reopen custody, shorten or lengthen live allocation, authorize a card, automatically charge a customer or security bond, create an invoice, notify the customer, or synchronize an external fleet. The separate settlement workflow currently records only real full-value manual/offline payment and refund evidence; provider-backed, partial, split-tender, and automatic collection remain separate production contracts. While custody is still open, the separate reschedule lifecycle now supports only a same-unit, current-start, later-end price-neutral extension; this post-return assessment never reopens that authority. Price-changing and broader rental extensions remain separate.

## Validation

`src/server/bookings/rental-late-return-domain.test.ts` covers timezone-aware late-day derivation, grace handling, exact-money validation, and waiver rules. `src/server/bookings/rental-custody-return-snapshot-domain.test.ts` covers unchanged handback evidence, valid later-end custody extensions, and fail-closed shortened/changed custody snapshots. `scripts/rental-late-return-source-contract.test.mjs` protects the original tenant/permission/persistence boundary, while `scripts/rental-custody-extension-return-reconciliation-source-contract.test.mjs` protects extension-aware return assessment and idempotent pickup replay semantics.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Live migration/trigger execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
