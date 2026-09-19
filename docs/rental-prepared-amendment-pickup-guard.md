# Rental prepared-amendment pickup guard

A prepared rental commercial amendment owns unresolved date and money authority. New physical pickup custody must not overtake that authority.

## Boundary

A `PREPARED` `RentalBookingCommercialAmendment` blocks a new `PICKED_UP` fulfillment event for the same tenant-owned booking. Staff must finish and apply the amendment, fully compensate and close it, or record its expiry before handing over the physical unit.

This guard applies only to **new pickup**. Existing pickup replay remains idempotent when its retained evidence still reconciles. Return remains recordable after custody has started even when a custody-extension amendment is prepared because SF must not suppress real physical handback evidence. The commercial amendment final-apply service already treats a retained return as a custody change and fails closed, so staff can compensate/close that amendment without rewriting the actual return.

## Server authority

`recordRentalBookingPickup` still requires `booking:manage` and `inventory:manage` and takes the shared tenant/booking advisory lock before the effective unit lock. Under that booking lock, the fresh-write path reads tenant-scoped commercial amendments and rejects pickup when one remains `PREPARED`. The check happens before a new fulfillment event or audit event is appended.

The staff booking-detail page uses the separate booking-read-authorized `readRentalBookingPickupCommercialGuard` only for UX. It removes the pickup primary action while a prepared amendment exists and, when the actor also has payment read access, links to the retained commercial workspace. This UI read is not the security boundary; a concurrent preparation after page render is still rejected by the locked writer.

## Database backstop

Migration `20260919143000-rental-pickup-prepared-amendment-guard` adds an independent PostgreSQL `BEFORE INSERT` trigger for `PICKED_UP` fulfillment rows. The trigger reacquires the same tenant/booking advisory lock and rejects a direct insert when a tenant-owned amendment is `PREPARED`.

This keeps application writes and direct database writes aligned and prevents a checkout race where real-world adjustment evidence is retained for target dates but custody begins under the older committed dates before final amendment apply.

## Deliberate behavior

The guard does not automatically apply, cancel, expire, compensate, collect, or refund an amendment. It does not block `RETURNED` custody evidence. It does not create a second commercial amendment or invent a provider-backed payment workflow.

Price-neutral reschedules, post-pickup custody extensions, effective settlement, compensation, and cancellation continue to use their existing production boundaries. See [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md), [rental-booking-commercial-amendment-apply.md](./rental-booking-commercial-amendment-apply.md), and [rental-booking-fulfillment-foundation.md](./rental-booking-fulfillment-foundation.md).

## Validation

`scripts/rental-prepared-amendment-pickup-guard-source-contract.test.mjs` protects the locked application check, PostgreSQL backstop, tenant-scoped staff read, no-dead-pickup-action behavior, and the deliberate return exception.

Full migration execution remains part of `npm run test:database` against an explicitly disposable PostgreSQL target under the repository Node version.

GitHub Actions are not required or used.
