# Rental security bond foundation

SF supports an explicit rental security-bond contract that stays separate from the immutable rental booking price and from post-return customer-damage settlement.

Authorized staff may establish one immutable positive bond requirement before custody begins, record one full-value manual/offline collection after money was actually received outside SF, and choose one terminal disposition: a full manual/offline release after the money was actually returned outside SF, or an explicit exact-full-value forfeiture against the same booking's retained customer damage liability. SF does not pretend that these evidence actions move money.

## Authority and tenant scope

Reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`. Organization and actor identity come only from authenticated server context.

Every service query repeats `organizationId` plus booking/bond identity. The requirement amount is parsed against the retained booking currency; browser input cannot choose tenant, currency, actor, idempotency, provider, timestamps, liability identity, or settlement amount.

Requirement, collection, release, and forfeiture writes serialize through tenant-owned advisory locks. Forfeiture additionally shares the physical-unit lock used by the damage workflow. Expected serialization/constraint races use the bounded rental write retry contract.

## Persisted evidence

`RentalSecurityBondRequirement` retains one immutable requirement per tenant booking. `RentalSecurityBondTransaction` retains append-only real manual/offline collection and release evidence with deterministic idempotency, request fingerprints, source attribution, exact money, and PostgreSQL-authored chronology.

`RentalSecurityBondForfeiture` is separate append-only accounting authority. It binds the tenant booking, bond, exact successful collection transaction, exact `CUSTOMER_LIABLE` damage decision, deterministic server-derived idempotency, exact bond currency/amount, actor, and PostgreSQL-authored timestamp. Composite foreign keys keep every retained relationship inside the tenant-owned booking and source evidence.

The derived bond states are:

- `REQUIRED` — a bond is required but no collection evidence exists;
- `COLLECTED` — the exact bond is retained as collected and has no terminal disposition;
- `RELEASED` — the full collected bond has matching release evidence;
- `FORFEITED` — the full collected bond has explicit exact-match damage-liability forfeiture evidence.

Release and forfeiture are mutually exclusive terminal dispositions. Partial amounts, unsupported transaction evidence, duplicate dispositions, currency mismatch, bad source attribution, invalid chronology, or mixed release/forfeiture evidence fail closed.

## Pickup and cancellation guards

A booking with no retained security-bond requirement preserves the existing pickup behavior. Once a requirement exists, PostgreSQL independently blocks `PICKED_UP` evidence unless the exact full bond is actively `COLLECTED`.

Cancellation remains blocked while a collected bond has no terminal disposition. A full release or a valid explicit forfeiture resolves that held-bond condition; neither outcome silently changes booking price evidence.

## Exact damage forfeiture

Forfeiture is deliberately narrow. It is available only after retained return custody evidence and a `CUSTOMER_LIABLE` decision for the same tenant booking. The liability currency and amount must exactly equal the collected bond requirement.

SF does not calculate a remainder, partially consume the bond, or partially satisfy customer damage liability. If the bond and liability differ, the forfeiture action is unavailable until a future partial-offset accounting contract exists.

The database independently serializes the liability settlement boundary and refuses forfeiture if any separate damage payment/refund evidence already exists. The inverse is also guarded: after forfeiture, a damage settlement transaction for that liability is rejected. The same terminal-disposition lock prevents a bond release and forfeiture from racing each other.

## Manual reference isolation

Manual security-bond collection/release references share the same tenant-wide rental reference namespace as booking-price, damage-liability, and late-return settlement. Before manual provider-adapter I/O, the service acquires the shared `sf:rental-manual-reference` advisory lock and verifies that the external reference is unused across booking-price, damage, security-bond, and late-return ledgers. The database independently repeats the same cross-scope guard at insert time, including concurrent and direct database writes.

Forfeiture has no provider reference because it is internal accounting authority over money already retained as a collected bond; it does not fabricate a new provider transaction.

## Staff workflow

The dedicated security-bond workspace exposes only actions backed by persisted production behavior: require a bond, record a real full manual/offline collection, release the full bond, or—when exact retained damage authority exists—type `FORFEIT` and explicitly apply the full collected bond to that liability.

The destructive action is shown only when the exact-match contract is eligible. After forfeiture, the retained evidence is read-only, separate damage collection is suppressed, and bond release is unavailable.

## Deliberate boundaries

This contract does not implement card authorization or capture, online bond checkout, partial bond collection/release, partial damage offset, split tenders, excess-bond remainder handling, undersecured liability allocation, insurance claims, chargebacks, provider-backed bond settlement, or customer self-service.

Forfeiture is never automatic. A damage decision alone cannot consume the bond; an authorized staff member must explicitly confirm the separate append-only forfeiture action.

## Validation

- `src/server/payments/rental-security-bond-domain.test.ts` covers required/collected/released/forfeited reconciliation, mutually exclusive dispositions, chronology, and deterministic idempotency.
- `scripts/rental-security-bond-source-contract.test.mjs` protects the existing requirement/collection/release foundation.
- `scripts/rental-security-bond-forfeiture-source-contract.test.mjs` protects exact-match forfeiture persistence, tenant/permission authority, server-derived idempotency, database serialization against release and separate damage settlement, confirmation UI, and the partial-offset boundary.
- `src/server/payments/rental-security-bond.integration.ts` remains the guarded disposable-PostgreSQL coverage for the base bond lifecycle. The new migration guards must also execute through `npm run test:database` before live database verification is claimed.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.

GitHub Actions are not required or used.
