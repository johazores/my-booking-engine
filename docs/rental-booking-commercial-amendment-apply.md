# Rental booking commercial amendment final apply

SF has a protected final-apply contract for a prepared, exactly settled, same-unit rental commercial date amendment. The authenticated commercial workspace now exposes this writer only after exact retained adjustment evidence exists and the actor has every required permission.

Final apply changes effective rental dates. It does not rewrite the immutable original booking-price snapshot and it does not execute payment collection/refund.

## Apply authority

`applyRentalBookingCommercialAmendment` requires `booking:manage`, `availability:read`, `availability:manage`, `inventory:read`, `pricing:read`, and `payment:manage`.

The writer runs under `Serializable`, takes the shared booking, amendment-settlement, and current effective-unit locks, uses PostgreSQL time, and revalidates:

- live `PREPARED` amendment authority and expiry;
- exact booking version and tenant ownership;
- current custody shape and retained pickup evidence;
- current effective physical allocation;
- competing target inventory and overdue custody;
- fresh target pricing and pricing fingerprint;
- original booking-price settlement; and
- exactly one successful uncompensated adjustment matching the retained amendment.

The staff form requires an explicit `APPLY` confirmation for accident resistance. That confirmation is not authority; the service performs all commercial and inventory validation independently.

## Durable apply evidence

Successful apply appends one `RentalBookingReschedule`, compare-and-swap updates only the effective allocation dates, versions the booking without rewriting accepted money, and terminally moves the amendment to `APPLIED` with linked reschedule and database-authored apply time.

PostgreSQL independently checks exact settlement and reschedule linkage. Applied lifecycle evidence is immutable. The reschedule insert guard permits a live `PREPARED` amendment only for the exact retained commercial terms/fingerprints used by final apply, and a deferred constraint requires that row to be linked to an `APPLIED` amendment before commit. This prevents direct SQL from bypassing the commercial terminal transition.

An idempotent replay of the same applied amendment reads the retained linked reschedule/allocation evidence and returns without creating another commercial change.

## Staff recovery when apply cannot proceed

A settled prepared amendment can become stale because time, inventory, custody, pricing, or booking version changed after external money moved.

The staff workspace therefore keeps exact compensation available while the amendment remains `PREPARED`, including after preparation expiry. Staff first reverse the real-world adjustment outside SF, then retain the exact compensation reference. Only compensated or never-settled preparation can close without apply.

This avoids trapping retained adjustment money behind stale inventory authority and avoids inventing an automatic provider refund.

## Effective post-apply settlement and refunds

After apply, [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) combines the immutable original ledger, applied adjustment, and post-apply refund evidence.

For an applied increase, refund authority unwinds the retained amendment payment first, then original booking-price sources.

For an applied decrease, the adjustment refund already consumes retained original source value before later refunds are planned.

`recordRentalBookingPostApplyManualRefund` is exposed through the authenticated commercial workspace for the supported manual/offline evidence path. Staff submit only a human amount and real-world refund reference. Currency and source are resolved server-side, and the writer re-plans under the booking lock before calling the manual adapter and appending evidence.

PostgreSQL independently caps source refunds and preserves the tenant-wide manual-reference namespace.

## Post-apply date authority

The applied amendment `afterTotalMinor` becomes the accepted effective commercial baseline for later same-unit date authority. The immutable `RentalBooking.totalMinor` remains booking-time evidence.

A later price-neutral reschedule or picked-up custody extension is allowed only when fresh server pricing preserves the applied amendment currency and exact `afterTotalMinor`. The writer repeats that check under locks and appends the effective total to the new reschedule evidence. PostgreSQL independently enforces the same baseline.

A second price-changing amendment remains unsupported. Physical-unit substitution remains fail-closed while an amendment is `PREPARED` or `APPLIED` until that workflow has its own effective-commercial-baseline contract.

## Post-apply cancellation

Cancellation after an applied amendment is supported only when the combined effective settlement is exact zero. The cancellation writer requires `fullyRefunded` and `currentNetSettledMinor === 0n` under the shared booking lock.

Cancellation never creates refund evidence or calls a provider.

## Current commercial boundary

Only one applied price-changing amendment per rental is supported. Later same-unit price-neutral reschedules/extensions may continue only at the accepted effective post-amendment total. Another price-changing commercial amendment and direct original booking-price ledger writes remain blocked.

Authenticated staff orchestration is implemented for the manual/offline path. Provider-backed/online amendment collection and refund execution remain separate adapter-backed scope.

## Validation

- `scripts/rental-booking-commercial-amendment-apply-source-contract.test.mjs` protects locked final apply and retained evidence.
- `scripts/rental-booking-commercial-amendment-staff-orchestration-source-contract.test.mjs` protects authenticated staff apply wiring and permission gating.
- `scripts/rental-post-commercial-neutral-reschedule-source-contract.test.mjs` protects the applied effective-total baseline and exact prepared-final-apply exception.
- `scripts/rental-booking-effective-refund-source-contract.test.mjs` protects post-apply refund source authority.
- `scripts/rental-booking-cancellation-source-contract.test.mjs` protects exact-zero post-apply cancellation.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.
- Database migration/drift/integration verification remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
