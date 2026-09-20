# Rental commercial amendment operational authority

A prepared rental commercial amendment is fresh future booking authority. It can later authorize a real manual/offline adjustment and a final date change, so retaining a new `PREPARED` row for stale, cross-tenant, returned, operationally unavailable, overdue-custody-conflicted, or expired physical inventory is not treated as harmless draft state.

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
- pre-pickup amendments have no pickup evidence, while custody extensions retain the exact tenant/booking/unit `PICKED_UP` event;
- `sf_assert_rental_unit_operationally_available` accepts the same unit under the shared physical-unit advisory lock; and
- no other tenant booking has overdue open custody of that physical unit at the fresh post-lock PostgreSQL time observation.

That readiness authority rejects `OUT_OF_SERVICE`, a returned unit awaiting inspection, and unresolved `DAMAGE_REPORTED` / `UNSAFE` return evidence until its damage workflow reaches terminal `WAIVED` or `CLOSED` evidence. The overdue-custody check deliberately excludes the amendment's own booking, so an eligible picked-up booking can still prepare its supported same-unit custody extension while another overdue booking on the same physical unit remains a hard conflict.

The supported preparation service now refreshes PostgreSQL time immediately after acquiring the physical-unit lock and uses that post-lock observation for active-hold expiry, overdue-custody reconciliation, and the new amendment expiry baseline. A pre-lock clock remains useful for stale-amendment cleanup and idempotent replay, but it is not reused as fresh inventory authority after waiting on the unit lock.

Expiry is checked both before expensive authority work and again after the physical-unit lock has been acquired. The second check is authoritative for retention because the lock wait itself can cross expiry. A `PREPARED` row therefore cannot be retained merely because it was live before waiting behind maintenance, return-readiness, damage, overdue custody, or another serialized unit mutation.

## Final apply backstop

Moving a retained amendment from `PREPARED` to `APPLIED` repeats physical-unit readiness, other-booking overdue-custody authority, and wall-clock expiry at the database update boundary after the shared physical-unit lock has been acquired. A direct or split write cannot retain a reschedule while the unit is ready and then apply the commercial amendment after authority expires, the unit becomes unsafe, or another overdue booking still physically retains the unit.

The supported final-apply service also refreshes PostgreSQL time after acquiring the unit lock and uses that observation for effective hold expiry, overdue-custody conflict detection, and the retained `appliedAt` timestamp. A pre-lock expiry observation may reject early, but it is not treated as final time authority.

If operational readiness changes, other overdue custody appears, or expiry is crossed after real adjustment money was recorded, apply fails closed and the existing compensation path remains the recovery mechanism.

## Adjustment settlement backstop

The application settlement service takes booking, amendment-settlement, and physical-unit locks, refreshes PostgreSQL time after the physical-unit lock, checks amendment expiry, and rechecks operational readiness plus other-booking overdue custody before recording new adjustment evidence. This happens before the manual provider adapter is asked to record new payment/refund evidence.

The database repeats operational readiness, post-lock expiry, and other-booking overdue-custody authority for every new `ADJUSTMENT` settlement insert. The trigger is intentionally ordered after the existing settlement authority trigger and before the cross-ledger manual-reference trigger. That preserves booking -> amendment settlement -> physical unit -> manual reference lock order across supported and direct-write paths.

Compensation is deliberately not blocked by current unit readiness, overdue custody, or by the post-lock expiry gate. Once adjustment money has been retained, a later maintenance, return-inspection, damage state, overdue-custody conflict, or elapsed preparation window must not trap the reversal path. Existing idempotent evidence also remains historical evidence rather than being reinterpreted as fresh authority.

## Authority boundary

This does not add another commercial-amendment type, second/chained repricing, provider-backed rental payment, automatic refund policy, or customer self-service. It strengthens the existing first same-unit price-changing date-amendment contract only.

PostgreSQL remains the final concurrency and direct-write authority. The application layer keeps responsibility for permissions, reviewed pricing fingerprints, staff-facing conflict handling, and the supported workflow; the database independently refuses structurally stale, operationally unsafe, overdue-custody-conflicted, or post-lock-expired fresh authority.

## Validation

`scripts/rental-commercial-amendment-operational-authority-source-contract.test.mjs` protects the preparation tenant/allocation/custody/readiness guard, adjustment-only settlement readiness, compensation availability, lock-order intent, supported application conflict mapping, post-physical-lock time observations, and the PostgreSQL overdue-custody backstop across preparation, adjustment settlement, and final apply.

Full repository validation remains `npm run validate` under the Node version declared in `package.json`. Live migration and concurrency validation remains `npm run test:database` only against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
