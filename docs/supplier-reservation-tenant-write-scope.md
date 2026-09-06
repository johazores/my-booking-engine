# Supplier reservation tenant write scope

## Purpose

Supplier reservation operations are tenant-owned commercial-write state. A successful tenant-scoped read does not by itself make a later mutation tenant-safe: every mutable operation and attempt update repeats the organization ID in the write predicate as defense in depth.

This hardening applies to the existing provider-neutral reservation ledger only. It does not enable Travelport reservation creation, modification, cancellation, a customer/staff supplier-booking route, or the `reservation` capability.

## Write-time invariant

Every production supplier reservation state transition keeps the existing server-side authority and transaction rules:

- validate organization, actor, and resource identifiers;
- require `booking:manage` before persistence or provider work;
- read the reservation through both reservation ID and organization ID;
- keep the shared tenant/operation advisory lock and serializable transaction where the ledger already requires them;
- recheck integration ownership, provider code, credential version, and capability when claiming work; and
- repeat `organizationId` beside the operation or attempt UUID in every Prisma `update` predicate.

The globally unique UUID remains useful identity, but a prior scoped read or globally unique identifier does not replace tenant scope on the write. This keeps organization ownership visible and enforceable at the database access boundary if surrounding service code is later refactored.

## Covered transitions

The invariant is applied consistently to the current supplier reservation lifecycle:

- create submission claims;
- create submission settlement;
- reconciliation claims;
- reconciliation settlement;
- durable provider-request boundary marking; and
- stale in-flight create/reconciliation lease recovery.

Both `HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` writes are covered. Provider-specific behavior remains outside these persistence services.

## Privacy and behavior

No new customer, traveler, payment, guarantee, credential, provider payload, or provider locator data is stored or logged by this tenant-scope invariant. The provider-request marker stores only a database timestamp on the current tenant-owned attempt and keeps audit evidence privacy-minimal.

The reservation state machine remains fail closed after provider I/O may have started. A stale create can return to `PREPARED` only when the durable provider-request marker is absent, proving the protected provider boundary was not crossed. Known-locator reconciliation still requires exact provider truth, and Travelport reservation capability remains disabled until the remaining live-provider and PCI-safe create dependencies are completed.

## Validation

`scripts/hospitality-supplier-reservation-tenant-write-scope.test.mjs` is a dependency-free source contract that verifies every current production supplier operation/attempt update includes `organizationId: input.organizationId`, including both attempt updates in provider-request marking and stale recovery, while the existing authorization and scoped-read boundaries remain present.

Full Node 24, Prisma, PostgreSQL, and live Travelport validation remain separate environment gates when those dependencies are available. No GitHub Actions are used for validation.
