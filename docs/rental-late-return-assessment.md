# Rental late-return assessment

SF supports an explicit post-return commercial assessment when retained rental custody evidence proves that a physical unit was returned after the booking's exclusive committed end date.

This is a commercial authority boundary, not an automatic fee engine. The overdue-custody guard remains operational inventory protection while the unit is still out. Only a retained `RETURNED` event can become the source of a late-return assessment.

## Source and time authority

The assessment uses the immutable pickup/return fulfillment snapshot for the physical unit and committed dates. The return event must belong to the same tenant booking and unit, must match the pickup event's retained dates, and cannot predate pickup. Lateness is calculated from the return timestamp in the retained booking location's IANA timezone.

Because rental `endsOn` is exclusive, returning on that local calendar date is late day 1. Each later local date adds one late day. PostgreSQL independently recomputes that rule before persistence instead of trusting browser or application-derived timing.

## Grace and fee decision

Authorized staff explicitly retain a case-specific grace period from 0 to 30 whole calendar days. SF does not infer a tenant-wide late policy from mutable configuration.

The assessment is append-only and is exactly one of:

- `FEE_ASSESSED`: at least one late day remains after grace and staff retain an exact positive fee amount in the booking currency;
- `WAIVED`: no fee amount is retained, with an explicit reason.

The fee is not calculated automatically from daily rates because no production late-fee policy exists yet. The retained amount is commercial authority only and does not change the accepted rental price.

## Authorization, tenant scope, and idempotency

Reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`. Every booking, fulfillment, and assessment lookup repeats `organizationId`.

The writer uses the shared tenant/booking advisory lock, serializable transaction retries, and the deterministic key `rental-late-return-assessment:<bookingId>`. PostgreSQL independently requires that exact key, exact tenant booking, exact return event, exact unit/date chronology, booking currency, and derived day counts. `assessedAt` and `createdAt` are authored with `clock_timestamp()` and update/delete are rejected.

The staff booking detail surfaces late-return evidence after return and exposes the assessment form only to actors with both management permissions. Retained assessments are read-only.

## Settlement boundary

The assessment itself never moves money. A retained `FEE_ASSESSED` decision can now feed the separate full-value manual/offline late-return settlement workflow. That workflow retains payment/refund evidence without mutating this assessment or the immutable rental booking price. A `WAIVED` assessment has no settlement action.

See [rental-late-return-settlement.md](./rental-late-return-settlement.md).

## Deliberate boundaries

This workflow does not extend a rental, reopen custody, shorten or lengthen live allocation, authorize a card, automatically charge a customer or security bond, create an invoice, notify the customer, or synchronize an external fleet. The separate settlement workflow currently records only real full-value manual/offline payment and refund evidence; provider-backed, partial, split-tender, and automatic collection remain separate production contracts. While custody is still open, the separate reschedule lifecycle now supports only a same-unit, current-start, later-end price-neutral extension; this post-return assessment never reopens that authority. Price-changing and broader rental extensions remain separate.

## Validation

`src/server/bookings/rental-late-return-domain.test.ts` covers timezone-aware late-day derivation, grace handling, exact-money validation, and waiver rules. `scripts/rental-late-return-source-contract.test.mjs` protects tenant/permission scope, shared locking, deterministic idempotency, PostgreSQL source authority, append-only persistence, safe form parsing, and separation between assessment authority and settlement.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Live migration/trigger execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
