# Rental commercial amendment operational authority

A prepared rental commercial amendment is fresh future booking authority. It can later authorize a real manual/offline adjustment and a final date change, so retaining a new `PREPARED` row for stale, cross-tenant, returned, operationally unavailable, or expired physical inventory is not treated as harmless draft state.

The supported preparation service runs under the tenant booking lock and the effective physical-unit lock, revalidates the current booking/allocation, current unit/type/location, custody state, pricing, settlement baseline, and reviewed fingerprint, then maps durable write conflicts back to a normal staff conflict. PostgreSQL independently protects the retained preparation boundary for direct SQL and races that happen after application review.

## Prepared authority guard

Every new commercial-amendment row must begin in `PREPARED`. The database guard takes the tenant booking advisory lock and requires the exact current tenant booking/allocation authority:

- the booking is still `CONFIRMED` and not cancelled;
- the proposed authority is still unexpired according to PostgreSQL wall-clock time;
- `bookingVersion` still matches the current booking version;
- the retained physical unit is the current allocation;
- source dates still match the current allocation;
- unit type and operating location still match the booking;
- the tenant-owned unit, unit type, and location are all active;
- no return has been recorded;
- pre-pickup amendments have no pickup evidence, while custody extensions retain the exact tenant/booking/unit `PICKED_UP` event; and
- `sf_assert_rental_unit_operationally_available` accepts the same unit under the shared physical-unit advisory lock.

That final readiness authority rejects `OUT_OF_SERVICE`, a returned unit awaiting inspection, and unresolved `DAMAGE_REPORTED` / `UNSAFE` return evidence until its damage workflow reaches terminal `WAIVED` or `CLOSED` evidence.

Expiry is checked both before expensive authority work and again after the physical-unit lock has been acquired. The second check is authoritative for retention because the lock wait itself can cross expiry. A `PREPARED` row therefore cannot be retained merely because it was live before waiting behind maintenance, return-readiness, damage, or another serialized unit mutation.

## Final apply backstop

Moving a retained amendment from `PREPARED` to `APPLIED` repeats physical-unit readiness at the database update boundary and now repeats wall-clock expiry after the shared physical-unit lock has been acquired. A direct or split write cannot retain a reschedule while the unit is ready and then apply the commercial amendment after authority expires or the unit becomes unsafe.

A pre-lock expiry check remains as a fast rejection, but it is not treated as final time authority. The post-lock check is the durable boundary that closes the wait-across-expiry race.

If operational readiness changes or expiry is crossed after real adjustment money was recorded, apply fails closed and the existing compensation path remains the recovery mechanism.

## Adjustment settlement backstop

The application settlement service takes booking, amendment-settlement, and physical-unit locks, refreshes PostgreSQL time after the physical-unit lock, checks amendment expiry, and rechecks operational readiness before recording new adjustment evidence. The database repeats the readiness check for every new `ADJUSTMENT` settlement insert and now also rechecks `expiresAt` after that readiness call has acquired the physical-unit lock.

The trigger is intentionally ordered after the existing settlement authority trigger and before the cross-ledger manual-reference trigger. That preserves booking -> amendment settlement -> physical unit -> manual reference lock order across supported and direct-write paths.

Compensation is deliberately not blocked by current unit readiness or by the new post-lock expiry gate. Once adjustment money has been retained, a later maintenance, return-inspection, damage state, or elapsed preparation window must not trap the reversal path. Existing idempotent evidence also remains historical evidence rather than being reinterpreted as fresh authority.

## Authority boundary

This does not add another commercial-amendment type, second/chained repricing, provider-backed rental payment, automatic refund policy, or customer self-service. It strengthens the existing first same-unit price-changing date-amendment contract only.

PostgreSQL remains the final concurrency and direct-write authority. The application layer keeps responsibility for permissions, reviewed pricing fingerprints, staff-facing conflict handling, and the supported workflow; the database independently refuses structurally stale, operationally unsafe, or post-lock-expired fresh authority.

## Validation

`scripts/rental-commercial-amendment-operational-authority-source-contract.test.mjs` protects the preparation tenant/allocation/custody/readiness guard, adjustment-only settlement readiness, compensation availability, lock-order intent, supported application conflict mapping, and the post-physical-lock expiry checks for preparation, adjustment settlement, and final apply.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Live migration and concurrency validation remains `npm run test:database` only against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
