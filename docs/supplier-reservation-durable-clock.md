# Supplier reservation durable clock authority

## Purpose

Supplier reservation attempts are commercial recovery evidence. Their durable chronology must not depend on application-node wall clocks that can drift independently across processes or hosts.

For provider-neutral supplier reservation operations, PostgreSQL `clock_timestamp()` is the authority for durable attempt claim and settlement timestamps. Application-node clocks are not commercial ordering authority.

## Durable timestamps

The `CREATE` and `RECONCILE` claim paths read the database clock inside the same serializable transaction that advances the operation and creates the attempt. The same timestamp is written to:

- `HospitalitySupplierReservationOperation.lastAttemptAt`; and
- `HospitalitySupplierReservationAttempt.startedAt`.

The `RECOVERY_WRITE` claim follows the same rule.

Settlement also reads PostgreSQL `clock_timestamp()` inside the serializable transaction:

- `CREATE` writes the database timestamp to the attempt `completedAt`;
- `RECONCILE` writes the same database timestamp to both operation `reconciledAt` and attempt `completedAt`; and
- `RECOVERY_WRITE` writes the database timestamp to the attempt `completedAt`.

The existing provider-request marker and stale-attempt recovery already use the database clock. Together, claim, provider-boundary, settlement, and stale-recovery evidence now share one durable clock authority.

## What this does not change

Provider adapters can still use a process clock when required to evaluate provider data, expiry windows, or request-local durations. Structured observability timestamps can also use process time because they are diagnostic records, not supplier settlement or retry authority.

This change does not infer historical network-send instants, does not make provider responses authoritative without the existing provider-request marker, and does not weaken tenant authorization, current-attempt checks, idempotency, or operation advisory locking.

## Validation

`npm test` includes `scripts/supplier-reservation-durable-clock-contract.test.mjs`, which guards the provider-neutral claim and settlement paths against reintroducing direct `new Date()` durable attempt timestamps and verifies the database-clock assignments.

Full migration and database behavior remains covered by the guarded disposable PostgreSQL suite when that environment is available.

## Activation boundary

Travelport `reservation` remains disabled. Durable clock consistency does not satisfy the remaining activation gates: a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less correlation, retry, and recovery semantics are still required.

See also:

- `docs/supplier-reservation-attempt-recovery.md`
- `docs/supplier-reservation-provider-evidence.md`
- `docs/supplier-reservation-operations.md`
- `docs/travelport-reservation-create-coordinator.md`
