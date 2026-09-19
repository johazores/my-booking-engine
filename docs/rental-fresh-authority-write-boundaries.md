# Rental fresh-authority write boundaries

SF treats physical-unit readiness as server-owned inventory authority, not a UI hint. A unit is not fresh-rental ready when it is explicitly `OUT_OF_SERVICE`, when retained `RETURNED` custody evidence still has no matching return inspection, or when a `DAMAGE_REPORTED` / `UNSAFE` return inspection has not reached terminal damage disposition through `WAIVED` or `CLOSED`.

PostgreSQL remains the final authority through `sf_assert_rental_unit_operationally_available`. Application services repeat the same evidence families where doing so prevents avoidable operational or money-side effects and gives staff a normal conflict before the durable database backstop fires.

## Pickup boundary

Fresh pickup runs under the shared tenant/booking lock followed by the effective physical-unit lock. Before security-bond and pickup-window completion can create new custody evidence, the service rechecks operational readiness for the exact tenant/unit.

A readiness contradiction fails as a fulfillment conflict. Idempotent replay of already-retained pickup evidence is deliberately not re-blocked by later readiness changes; replay validates the historical event against the retained effective assignment instead of pretending the handoff never occurred.

The existing PostgreSQL pickup guard still performs independent fresh-rental readiness validation at insert time, so concurrent direct writes or state changes fail closed.

## Commercial-amendment adjustment settlement

A prepared commercial amendment can lead to real-world adjustment money being recorded before final date apply. Because of that side effect, new adjustment settlement now takes the same physical-unit lock after the booking and amendment-settlement locks, refreshes PostgreSQL time after waiting for that lock, and rejects expired or operationally unready authority before any new manual payment/refund evidence is recorded.

This guard applies only to **new adjustment settlement**. Exact idempotent replay of already-retained adjustment evidence remains valid, and compensation remains available even when the unit is operationally unavailable. That is intentional: safety state must never trap already-moved money by blocking the reversal path.

Final commercial-amendment apply and other rental mutation inserts remain protected by PostgreSQL fresh-rental authority. If readiness changes after a valid adjustment is recorded but before final apply, apply fails closed and the retained compensation workflow remains the supported recovery path.

## Lock order

The added application checks preserve existing lock order:

1. tenant/booking authority;
2. commercial-amendment settlement authority where applicable; and
3. tenant/physical-unit authority.

Inventory readiness writers use the same physical-unit lock namespace. This serializes the decision against maintenance, return-readiness, damage, and other operational state transitions without introducing a separate authority model.

## Validation boundary

`scripts/rental-fresh-authority-read-parity-source-contract.test.mjs` protects both read-side parity and these high-impact write boundaries. Full repository validation remains `npm run validate` under the Node version declared in `package.json`, and database behavior remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
