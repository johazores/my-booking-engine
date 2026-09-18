# Rental booking commercial amendment final apply

SF has a server-only final apply contract for a prepared, exactly settled, same-unit rental commercial date amendment. The apply service closes the backend transaction from reviewed price change through durable adjustment evidence into an effective rental date change without rewriting the original accepted booking-price snapshot.

This is still **not** exposed as a staff primary action. The current product does not present a workflow that can prepare an amendment, move adjustment money, and invoke final apply. Keeping the route/UI absent avoids presenting partial commercial orchestration as complete.

## Apply authority

`applyRentalBookingCommercialAmendment` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, `pricing:read`, and `payment:manage`.

The writer runs in a serializable transaction with bounded retry handling. It acquires the shared tenant/booking lock, the commercial-amendment settlement lock, and the current effective physical-unit lock. PostgreSQL `clock_timestamp()` is the time authority.

Before writing it revalidates all of the following from tenant-scoped persistence:

- the amendment is still `PREPARED` and has not expired;
- the booking is still confirmed and its `updatedAt` version exactly matches the prepared amendment;
- the retained effective unit, unit type, location, allocation, source dates, source pricing fingerprint, and source effective total still match the prepared evidence;
- pickup/return evidence still matches the retained pre-pickup or custody-extension mode and pickup-event identity;
- the target dates still have no block, active competing hold, other booking allocation, or overdue-custody conflict;
- the effective unit, type, and location remain active;
- fresh target pricing has the exact prepared currency, total, and pricing fingerprint;
- the original booking-price ledger is still completely reconciled as `PAID` for the immutable original booking total; and
- the amendment settlement ledger derives exactly `SETTLED`: one successful manual adjustment matching the exact delta and no compensation.

If any authority changed after adjustment money moved, final apply fails closed. Staff must use the existing compensation boundary before the prepared amendment can be cancelled or expired.

## Durable apply evidence

Final apply appends one `RentalBookingReschedule` row using a deterministic amendment-derived idempotency key. The row retains the exact source/target dates, source/target pricing fingerprints, fresh target pricing snapshot, effective target total, retained review fingerprint, and database-authored apply time.

The effective `RentalBookingAllocation` dates are then compare-and-swap updated from the prepared source dates to the target dates. The original `RentalBooking` commercial snapshot remains immutable; only `updatedAt` advances as the booking version. The amendment moves terminally from `PREPARED` to `APPLIED` and retains `appliedRescheduleId`, `appliedAt`, and `endedAt`.

PostgreSQL independently checks that an `APPLIED` amendment has exactly one uncompensated successful adjustment and that its linked reschedule belongs to the same tenant/booking and exactly matches the amendment source dates, target dates, currency, target total, pricing fingerprints, review fingerprint, and apply timestamp. Applied lifecycle evidence is immutable.

Idempotent replay of an already-applied amendment only succeeds when the linked reschedule evidence is still complete and matching.

## Effective settlement read authority

The protected read model in [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) now reconciles the immutable original booking-price ledger with the one supported applied commercial amendment.

For an applied increase, it adds the retained amendment payment to original booking-price net settlement and keeps the future refund remainder split between the original ledger and the amendment charge. For an applied decrease, it treats the retained amendment adjustment as an already-completed source-attributed refund against the original payment before calculating remaining effective net. Terminal reschedule linkage and adjustment request fingerprints are rechecked before those values are trusted.

This removes ambiguity from post-apply read semantics without weakening write safety.

## Current commercial boundary

The current rental money model deliberately supports **one applied price-changing amendment per rental**. A unified effective settlement **read model is implemented**, but chained commercial amendments still require a write model that can safely source later refunds from both the original booking-price ledger and prior amendment adjustments.

The migration therefore continues to fail closed after an applied commercial amendment for:

- additional rental reschedule rows;
- new booking-price settlement transactions; and
- booking cancellation.

These guards prevent existing original-price cancellation/refund logic from silently over-refunding, under-refunding, or ignoring amendment adjustment money. Damage, security-bond, late-return, and physical fulfillment evidence remain separate concerns and are not reclassified as booking-price settlement.

The next commercial dependency is the adjustment-aware post-apply **write** contract: exact refund allocation across original and amendment ledgers, database enforcement of the combined effective net, cancellation only after that net reaches zero, and then a complete authenticated staff orchestration surface. Provider-backed/online amendment money remains a later adapter-backed scope.

## Product surface

There is no route or primary staff action for commercial amendment preparation, settlement, or final apply in this slice. The existing rental reschedule screen may truthfully show a price change, but it does not offer a button that can move money or apply that commercial change.

## Validation

- `scripts/rental-booking-commercial-amendment-apply-source-contract.test.mjs` protects schema linkage, database apply authority, tenant/permission/lock checks, exact settlement, append-only reschedule evidence, original booking-price immutability, and the fail-closed post-apply boundary.
- `src/server/bookings/rental-booking-effective-settlement-domain.test.ts` covers the combined post-apply money read model.
- `scripts/rental-booking-effective-settlement-source-contract.test.mjs` protects tenant scope, bounded settlement reads, retained request/reschedule evidence, and the deliberately blocked post-apply write boundary.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database migration/drift/integration verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
