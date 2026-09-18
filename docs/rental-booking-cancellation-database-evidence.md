# Rental booking cancellation database evidence

Rental cancellation already uses a serializable application transaction that changes the tenant-owned booking to `CANCELLED` and writes one `booking.rental.cancelled` audit event in the same transaction. The database now also enforces the relationship between those two records at commit time so direct SQL, future internal writers, or statement-order changes cannot leave a terminal rental cancellation without matching retained evidence.

## Deferred commit-time contract

Migration `20260918053000_rental-booking-cancellation-evidence-guard` installs a tenant-scoped validation function plus deferred constraint triggers on `rental_bookings` and `audit_events`.

The triggers are `DEFERRABLE INITIALLY DEFERRED`. This is required because the production service first performs the guarded `CONFIRMED -> CANCELLED` booking mutation and then creates the audit row before the surrounding serializable transaction commits. Per-statement validation would reject that valid transaction between those two writes. Commit-time validation checks the complete transaction instead.

For a tenant booking that is not `CANCELLED`, no `booking.rental.cancelled` / `rental-booking` audit event may exist. For a cancelled tenant booking, the database requires exactly one matching audit event and a retained physical allocation.

The cancellation audit `afterData` must retain the same bounded evidence used by application replay verification:

- `status` is exactly `CANCELLED`;
- `cancelledAt` is a string timestamp equal to `RentalBooking.cancelledAt`;
- `allocationId` is a string equal to the tenant-owned retained allocation ID;
- `inventoryProtectionReleased` is exactly the JSON boolean `true`;
- `cancellationReason` is a non-empty canonical string, already whitespace-normalized and at most 1000 characters.

A matching cancellation audit whose tenant/resource no longer resolves to a rental booking is rejected. Updating or deleting an existing cancellation audit is also checked against the terminal booking before commit.

The earlier partial unique index still enforces *at most one* cancellation audit for a tenant booking. This deferred contract adds the inverse requirement that a cancelled booking has *exactly one* structurally consistent event and that non-cancelled bookings have none.

## Deployment preflight

The migration calls the same validator across every existing cancelled rental booking and every existing rental-cancellation audit reference before installing the triggers. If historical data is missing, duplicated, orphaned, malformed, or divergent, migration deployment fails deliberately.

SF does not invent a reason, timestamp, allocation, actor, fee, refund, or other commercial evidence to make old data pass. Historical inconsistencies must be reviewed and repaired from authoritative records before retrying the migration.

## Scope

This is an integrity guard only. It does not calculate cancellation fees, perform automatic refunds, release or forfeit security bonds, call a payment provider, notify a customer, create tax adjustments, reverse custody, or synchronize an external provider. Those remain separate commercial workflows.

Application authorization, tenant scope, payment-zero cancellation gating, booking/current-unit advisory locks, custody checks, normalized reason validation, and replay verification remain unchanged. The database guard is defense in depth for the retained terminal cancellation evidence.

## Validation

`scripts/rental-booking-cancellation-evidence-guard-source-contract.test.mjs` protects the deferred trigger shape, deployment preflight, tenant/resource scoping, exact-one audit requirement, non-cancelled prohibition, canonical reason bound, terminal timestamp, retained allocation match, and the no-fake-financial-workflow boundary.

Live execution still requires `npm run test:database` against the explicitly disposable PostgreSQL target. The migration is not claimed as executed until that environment is available.
