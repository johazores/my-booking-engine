# Rental booking commercial amendment final apply

SF has a server-only final apply contract for a prepared, exactly settled, same-unit rental commercial date amendment. Apply closes the backend transaction from reviewed price change through durable adjustment evidence into an effective date change without rewriting the original accepted booking-price snapshot.

This workflow is still not exposed as a staff primary action. The product does not present partial commercial orchestration as complete.

## Apply authority

`applyRentalBookingCommercialAmendment` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, `pricing:read`, and `payment:manage`.

The writer runs in a serializable transaction, takes the shared booking, amendment-settlement, and effective-unit locks, uses PostgreSQL time authority, and revalidates live amendment authority, booking version, custody, effective allocation, target inventory, fresh target pricing, original booking-price reconciliation, and exact uncompensated adjustment evidence.

## Durable apply evidence

Final apply appends one `RentalBookingReschedule`, compare-and-swap updates only the effective allocation dates, versions the booking without rewriting its original commercial snapshot, and terminally moves the amendment to `APPLIED` with linked reschedule and database-authored apply time.

PostgreSQL independently checks the exact applied settlement and reschedule linkage. Applied lifecycle evidence is immutable.

## Effective post-apply settlement and refunds

The protected model in [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) reconciles the original booking ledger, the applied adjustment, and durable post-apply refund evidence.

For an applied increase, refund authority unwinds the retained amendment payment first, then original booking-price sources. For an applied decrease, the adjustment refund already consumes its retained original source before later refunds are planned.

`recordRentalBookingPostApplyManualRefund` is the server-only write boundary. It derives the source server-side, requires the requested amount to fit one authoritative source, uses deterministic idempotency and request evidence, calls the manual provider adapter, appends dedicated post-apply refund evidence, then re-reads the combined effective settlement inside the same serializable transaction.

PostgreSQL independently caps refunds per source and preserves the tenant-wide manual reference namespace across booking payments, damage, security bonds, late return, commercial amendment settlement, and post-apply refund evidence.

## Post-apply cancellation

Cancellation after an applied commercial amendment is supported only after the combined effective settlement reaches exact zero. The cancellation writer reuses the protected effective-settlement reader under the shared booking lock and requires `fullyRefunded` plus zero `currentNetSettledMinor`.

PostgreSQL independently verifies the original booking ledger still equals the amendment before-total, the exact uncompensated applied adjustment remains intact, and post-apply effective refund evidence totals the amendment after-total. The prior blanket cancellation block has been replaced by this exact commercial condition. Cancellation does not create refund evidence or call a provider.

## Current commercial boundary

The money model supports one applied price-changing amendment per rental. Another rental reschedule, another commercial amendment, and direct writes to the original booking-price ledger remain blocked after an applied commercial amendment. This prevents older original-total logic from bypassing the dedicated effective settlement contract.

Authenticated staff orchestration for preparing, settling, and applying the commercial amendment remains later work. Provider-backed/online amendment and refund execution remains behind provider adapters as a separate scope.

## Product surface

There is no route or primary staff action for commercial amendment preparation, settlement, final apply, or post-apply refund recording in this slice. The existing cancellation section does consume effective settlement when such retained commercial evidence exists, so it does not expose an original-ledger-only cancellation decision.

## Validation

- Commercial amendment preparation/settlement/apply source-contract tests protect the existing final-apply boundary.
- `src/server/bookings/rental-booking-effective-refund-domain.test.ts` covers source-aware post-apply refund authority.
- `scripts/rental-booking-effective-refund-source-contract.test.mjs` protects persistence, database source caps, permissions, locking, provider-adapter usage, and no fake refund UI.
- `scripts/rental-booking-cancellation-source-contract.test.mjs` protects exact-zero post-apply cancellation authority.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database migration/drift/integration verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
