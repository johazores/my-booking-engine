# Rental security bond foundation

SF supports an explicit rental security-bond contract that stays separate from the immutable rental booking price and from post-return customer-damage settlement.

Authorized staff may establish one immutable positive bond requirement before custody begins, record one full-value manual/offline collection after money was actually received outside SF, and choose one terminal disposition: a full manual/offline release after the money was actually returned outside SF, or an explicit exact-full-value forfeiture against the same booking's retained customer damage liability. SF does not pretend that these evidence actions move money.

## Authority and tenant scope

Detailed security-bond reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`. Organization and actor identity come only from authenticated server context.

The booking workflow also has a deliberately minimal `booking:read` operational projection that exposes only whether a bond requirement exists, the derived lifecycle state, and whether pickup or cancellation is blocked. It does not expose bond amounts, provider references, or transaction details. See [rental-security-bond-operational-guards.md](./rental-security-bond-operational-guards.md).

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

A booking with no retained security-bond requirement preserves the existing pickup behavior. Once a requirement exists, a new `PICKED_UP` event requires the exact full bond to be actively `COLLECTED`.

The fulfillment writer now reconciles that tenant-owned bond state under the existing booking transaction before new pickup evidence is inserted. The staff booking page uses the minimal operational projection to remove the dead pickup action while the requirement is not actively collected. PostgreSQL independently enforces the same boundary for direct or concurrent writes.

Cancellation remains blocked while a collected bond has no terminal disposition. The cancellation writer checks the reconciled held-bond state under the locked booking transaction before the terminal booking update, and the staff page suppresses the cancellation control while money remains held. A full release resolves that pre-pickup held-bond condition. Forfeiture is a post-return damage-liability path, when normal booking cancellation is already unavailable, and does not reopen cancellation. Neither disposition silently changes booking price evidence. PostgreSQL remains the independent final backstop.

See [rental-security-bond-operational-guards.md](./rental-security-bond-operational-guards.md) for the booking-facing projection and no-dead-action contract.

## Exact damage forfeiture

Forfeiture is deliberately narrow. It is available only after retained return custody evidence and a `CUSTOMER_LIABLE` decision for the same tenant booking. The liability currency and amount must exactly equal the collected bond requirement.

SF does not calculate a remainder, partially consume the bond, or partially satisfy customer damage liability. If the bond and liability differ, the forfeiture action is unavailable until a future partial-offset accounting contract exists.

The database independently serializes the liability settlement boundary and refuses forfeiture if any separate damage payment/refund evidence already exists. The inverse is also guarded: after forfeiture, a damage settlement transaction for that liability is rejected. The same terminal-disposition lock prevents a bond release and forfeiture from racing each other.

## Manual reference isolation

Manual security-bond collection/release references use the central tenant-wide `RentalManualProviderReference` namespace shared by booking-price payment/refund, commercial-amendment adjustment/compensation, post-apply effective refunds, damage settlement, security bonds, and late-return settlement. Before manual provider-adapter I/O, the service acquires the shared `sf:rental-manual-reference` advisory lock and rejects any retained reference already owned by that tenant-wide registry. PostgreSQL independently registers and rejects cross-ledger collisions for concurrent and direct database writes.

Forfeiture has no provider reference because it is internal accounting authority over money already retained as a collected bond; it does not fabricate a new provider transaction.

## Staff workflow

The dedicated security-bond workspace exposes only actions backed by persisted production behavior: require a bond, record a real full manual/offline collection, release the full bond, or—when exact retained damage authority exists—type `FORFEIT` and explicitly apply the full collected bond to that liability.

The destructive action is shown only when the exact-match contract is eligible. After forfeiture, the retained evidence is read-only, separate damage collection is suppressed, and bond release is unavailable.

## Staff action and snapshot consistency

The forfeiture eligibility reader requires the same confirmed-booking status as the serializable forfeiture writer. The staff bond workspace reads the financial bond and forfeiture projections in separate tenant-authorized repeatable-read transactions; it compares booking status, retained bond identity, transaction identities, forfeiture identity, derived settlement state, and terminal forfeiture presence before displaying actions. If those projections disagree, it fails closed with a reload link rather than showing a potentially stale action.

Matching projections are not a shared database snapshot: intervening liability or custody changes can still occur. All writes revalidate authority under their own locks and PostgreSQL constraints.

## Deterministic requirement identity and chronology

The financial security-bond reader, forfeiture reader, and booking-only pickup/cancellation guard all rebuild the retained requirement idempotency key from the exact booking identity, currency, and positive amount. They also reject invalid requirement timestamps and any collection, release, or forfeiture evidence that predates the requirement. An exact requirement-creation replay reconciles the entire retained bond history before reporting success. This deterministic requirement identity and chronology check does not replace PostgreSQL constraints or serializable write authority. The booking-only projection still exposes no amounts, provider references, or payment details.

## Retained liability and custody evidence

The financial security-bond reader, forfeiture eligibility reader, and booking-only operational projection each fail closed when retained forfeiture no longer matches its tenant-owned `CUSTOMER_LIABLE` decision, exact amount/currency, or returned custody of the same physical unit. They also reject a forfeiture that predates its liability decision or return event, a customer-liability decision dated before returned custody, or evidence coexisting with separate damage settlement. Fresh forfeiture eligibility enforces the same return-before-decision chronology before offering a destructive action. These checks run within each reader's tenant-scoped transaction and do not expose payment details to booking-only callers. PostgreSQL remains the independent serializable write authority.

## Deliberate boundaries

This contract does not implement card authorization or capture, online bond checkout, partial bond collection/release, partial damage offset, split tenders, excess-bond remainder handling, undersecured liability allocation, insurance claims, chargebacks, provider-backed bond settlement, or customer self-service.

Forfeiture is never automatic. A damage decision alone cannot consume the bond; an authorized staff member must explicitly confirm the separate append-only forfeiture action.

## Validation

- `src/server/payments/rental-security-bond-domain.test.ts` covers required/collected/released/forfeited reconciliation, mutually exclusive dispositions, chronology, and deterministic idempotency.
- `scripts/rental-security-bond-source-contract.test.mjs` protects the existing requirement/collection/release foundation.
- `scripts/rental-security-bond-forfeiture-source-contract.test.mjs` protects exact-match forfeiture persistence, tenant/permission authority, server-derived idempotency, database serialization against release and separate damage settlement, confirmation UI, and the partial-offset boundary.
- `scripts/rental-security-bond-operational-guard-source-contract.test.mjs` protects the booking-read operational projection, locked pickup/cancellation preflight, existing PostgreSQL backstops, and dead-action removal on the staff booking page.
- `src/server/payments/rental-security-bond.integration.ts` remains the guarded disposable-PostgreSQL coverage for the base bond lifecycle. The migration guards must execute through `npm run test:database` before live database verification is claimed.
- Full repository validation remains `npm run validate` under the Node version declared by `package.json`.

GitHub Actions are not required or used.

## Retained bond evidence validation

The financial settlement reader and booking pickup/cancellation guard share a pure retained-transaction validator. Both independently reject noncanonical references, invalid source attribution, malformed timestamps, amounts, currency and fingerprints, and operation/reference idempotency mismatches before trusting a stored fingerprint. The operational guard also verifies the forfeiture collection source and derived idempotency key. The dedicated forfeiture reader and writer now use the same retained-transaction and forfeiture-source validators, rejecting malformed or hidden non-success rows instead of filtering them out. Existing tenant and permission checks remain in their services. Live Node 24 and disposable PostgreSQL validation remain outstanding.

The detailed financial security-bond reader also includes the append-only forfeiture disposition in reconciliation, so a forfeited bond is no longer reported as collected. A replay of its original manual collection remains idempotent after forfeiture, without reopening release or further settlement.

## PostgreSQL return-before-liability enforcement

The follow-up migration `20261015013000-rental-bond-liability-return-chronology` adds an independent insert trigger for security-bond forfeiture. It requires a tenant/booking/unit-matched `RETURNED` fulfillment event whose database-authored `occurredAt` is no later than the retained customer-liability `decidedAt`. This complements the original forfeiture trigger without rewriting deployed migration history, changing the original settlement locks, or changing the immutable accounting contract. The server checks this chronology for both new forfeiture eligibility and retained forfeiture reads; PostgreSQL independently rejects direct inserts that violate it. This is checked-in migration/source-contract coverage, **not** a claim that the migration was applied to live PostgreSQL.
