# Rental security-bond pickup-window authority

SF does not allow new security-bond obligations to be created after the retained rental period has already become a missed pickup.

A security bond is customer money held for a current custody obligation. Once the confirmed booking reaches its exclusive effective `endsOn` date without pickup, the existing rental pickup contract no longer permits custody handoff under that period. Creating a new bond requirement or recording a new collection after that boundary would therefore retain money against dates that can no longer authorize pickup.

## Server authority

Fresh security-bond requirement and collection writes run under the shared tenant/booking advisory lock.

The server derives the current effective rental end from the latest tenant-owned `RentalBookingReschedule`, ordered by `appliedAt`, `createdAt`, and `id`, falling back to the immutable booking end when there is no reschedule. It combines that retained date with PostgreSQL `clock_timestamp()` and the retained booking location timezone through the same pickup-window domain used by fulfillment.

New requirement and collection authority requires all of the following:

- the tenant-owned booking is still `CONFIRMED` and is not cancelled;
- no pickup or return evidence exists;
- the current local date is still before the exclusive effective end date.

The rule intentionally does not require the rental start date to have arrived. A real bond may be required or collected in advance of pickup.

Exact idempotent replay of already-retained requirement or collection evidence remains available after the boundary because replay verifies historical evidence instead of creating a new customer-money obligation.

## Release is deliberately different

A manual/offline bond release is never blocked merely because the pickup window has closed or custody has already begun.

Release exists to record that already-held customer money was actually returned outside SF. Suppressing that action after a lifecycle boundary would trap retained money evidence and could prevent later cancellation or reconciliation. The fresh-write guard therefore applies only to requirement inserts and `OFFLINE_PAYMENT` collection inserts, never `REFUND` release evidence.

Forfeiture keeps its separate post-return exact damage-liability authority.

## PostgreSQL backstop

`20260919083000_rental_security_bond_pickup_window_guard` independently protects direct and concurrent writes.

The trigger:

- takes the same tenant/booking advisory lock;
- resolves only a tenant-owned confirmed, non-cancelled booking;
- refuses fresh authority after any tenant-owned fulfillment evidence;
- derives the latest tenant-owned reschedule end with the same deterministic ordering;
- resolves the retained tenant-owned location timezone;
- uses `clock_timestamp()` rather than caller or application-server time;
- rejects fresh requirement or collection inserts at or after the exclusive effective end.

The transaction trigger is scoped with `WHEN (NEW."kind" = 'OFFLINE_PAYMENT')`, so a real release remains recordable.

This also closes a database-authority gap from the original bond migration: direct SQL can no longer insert a new collection after the booking has been cancelled merely because no custody evidence exists.

## Staff experience

The security-bond workspace reads the same server-derived pre-custody authority.

When a confirmed booking has already entered custody, the page removes new requirement/collection actions and explains that setup is closed after handoff. When the booking has no custody evidence but its exclusive effective end has passed, the page identifies the missed-pickup boundary and directs staff to reschedule or cancel rather than holding new bond money under expired dates.

Existing collected money still exposes the real release action.

## Deliberate boundaries

This hardening does not invent automatic cancellation, no-show fees, refunds, extensions, bond amounts, or customer policy. It does not change the accepted rental price and does not move money.

A future reschedule that establishes a new valid effective period can reopen fresh bond setup only when all existing bond invariants and lifecycle rules still permit it. Existing immutable bond requirements remain immutable.

## Validation

`scripts/rental-security-bond-pickup-window-source-contract.test.mjs` protects the server clock/date authority, idempotent replay ordering, pre-provider collection cutoff, PostgreSQL backstop, release exception, and no-dead-action staff behavior.

Full migration execution remains part of the guarded disposable-PostgreSQL validation path under the Node version declared by `package.json`.

GitHub Actions are not required or used.
