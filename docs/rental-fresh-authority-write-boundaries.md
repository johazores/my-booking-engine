# Rental fresh-authority write boundaries

SF treats physical-unit readiness as server-owned inventory authority, not a UI hint. A unit is not fresh-rental ready when it is explicitly `OUT_OF_SERVICE`, when retained `RETURNED` custody evidence still has no matching return inspection, or when a `DAMAGE_REPORTED` / `UNSAFE` return inspection has not reached terminal damage disposition through `WAIVED` or `CLOSED`.

PostgreSQL remains the final authority through `sf_assert_rental_unit_operationally_available`. Application services repeat the same evidence families where doing so prevents avoidable operational or money-side effects and gives staff a normal conflict before the durable database backstop fires.

## Pre-booking authority

Availability discovery, hold creation, conversion review, and booking confirmation now use one shared application readiness contract instead of maintaining separate copies of the return-readiness predicate.

Discovery filters operationally unready units before staff can select them. Fresh hold creation then takes the tenant/unit advisory lock and rechecks the exact unit under that lock before retaining new live hold authority. Conversion review uses the same blocker contract before it can mint a booking authority fingerprint. Final booking confirmation reacquires the physical-unit lock and rechecks readiness before the source hold is consumed or booking/allocation evidence is written.

Idempotent replay remains ahead of the fresh-readiness gate. An already-retained hold or booking is historical evidence and is not made unreplayable merely because the unit later enters maintenance, awaits return inspection, or receives unresolved non-clear return evidence.

The PostgreSQL active-hold, booking, and allocation guards still apply the same fresh-rental predicate independently. A direct SQL write or a readiness change racing after application review therefore still fails closed.

## Pickup boundary

Fresh pickup runs under the shared tenant/booking lock followed by the effective physical-unit lock. Before security-bond and pickup-window completion can create new custody evidence, the service rechecks operational readiness for the exact tenant/unit.

A readiness contradiction fails as a fulfillment conflict. Idempotent replay of already-retained pickup evidence is deliberately not re-blocked by later readiness changes; replay validates the historical event against the retained effective assignment instead of pretending the handoff never occurred.

The existing PostgreSQL pickup guard still performs independent fresh-rental readiness validation at insert time, so concurrent direct writes or state changes fail closed.

## Commercial-amendment adjustment settlement

A prepared commercial amendment can lead to real-world adjustment money being recorded before final date apply. Because of that side effect, new adjustment settlement takes the same physical-unit lock after the booking and amendment-settlement locks, refreshes PostgreSQL time after waiting for that lock, and rejects expired or operationally unready authority before any new manual payment/refund evidence is recorded.

This guard applies only to **new adjustment settlement**. Exact idempotent replay of already-retained adjustment evidence remains valid, and compensation remains available even when the unit is operationally unavailable. That is intentional: safety state must never trap already-moved money by blocking the reversal path.

Final commercial-amendment apply and the other protected rental mutation inserts remain subject to PostgreSQL fresh-rental authority. If readiness changes after a valid adjustment is recorded but before final apply, apply fails closed and the retained compensation workflow remains the supported recovery path.

## Commercial-amendment durable preparation authority

A new `PREPARED` commercial amendment is also fresh authority rather than inert draft data. PostgreSQL now requires it to match the exact current tenant booking/allocation, booking version, source dates, active unit/type/location assignment, and custody mode before it may be retained. The insert then calls the same physical-unit readiness authority used by the rest of the rental write boundary.

The database also repeats wall-clock expiry plus readiness when `PREPARED` becomes `APPLIED`, and repeats readiness for new commercial-amendment `ADJUSTMENT` settlement rows. `COMPENSATION` deliberately bypasses that new guard so operational state can never strand already-moved money. See [rental-commercial-amendment-operational-authority.md](./rental-commercial-amendment-operational-authority.md).

## Lock order

Application checks preserve the existing lock hierarchy rather than introducing another authority namespace. Pre-booking writes take their idempotency/booking authority first and then the tenant/physical-unit authority. Commercial-amendment settlement takes booking authority, amendment-settlement authority, and then tenant/physical-unit authority.

Inventory readiness writers use the same physical-unit lock namespace. The commercial-amendment database preparation guard takes booking authority before physical-unit authority, while adjustment settlement preserves booking -> amendment settlement -> physical unit -> manual reference ordering. This serializes readiness decisions against maintenance, return-readiness, damage, and other operational state transitions without introducing a separate authority model.

## Validation boundary

`scripts/rental-fresh-authority-read-parity-source-contract.test.mjs` protects read-side parity, fresh pre-booking writes, pickup, adjustment settlement, and the PostgreSQL-backstop contract. `scripts/rental-commercial-amendment-operational-authority-source-contract.test.mjs` protects the durable preparation and adjustment-readiness boundary. Full repository validation remains `npm run validate` under the Node version declared in `package.json`, and database behavior remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
