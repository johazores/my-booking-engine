# Rental booking cancellation

SF implements a staff-only rental booking cancellation lifecycle for the durable confirmed rental booking contract. Cancellation is an inventory-release state transition, not deletion and not a financial workflow. It changes one tenant-owned `CONFIRMED` rental booking to `CANCELLED`, records database cancellation time plus a required normalized cancellation reason in durable audit evidence, retains immutable booking/customer evidence plus append-only reschedule/substitution/commercial history and the current physical allocation as historical evidence, and releases that effective physical-unit/date commitment from live availability.

## Authority and tenant scope

`cancelRentalBooking` is server-only. It validates organization, actor, and booking UUIDs and independently requires:

- `booking:manage`, because the operation changes durable booking lifecycle
- `availability:manage`, because cancellation releases protected physical inventory

The staff route derives organization and actor from authenticated server context. The browser may submit only the human cancellation reason. It cannot choose tenant, actor, unit, dates, customer, price, cancellation time, settlement source, applied amendment, security-bond state, or inventory-release authority.

The service contract requires a cancellation reason for every caller. Runtime normalization rejects non-string input, trims outer whitespace, collapses internal whitespace, requires a non-empty value, and enforces the 1000-character retention bound before any lifecycle mutation is attempted.

Every booking, reschedule, substitution, commercial-amendment, booking-price payment, post-apply refund, and security-bond read used by cancellation is tenant-scoped. A booking ID from another tenant resolves as unavailable rather than becoming cross-tenant mutation authority.

## Serialization and effective allocation

Cancellation runs in a serializable transaction. It acquires the shared tenant-and-booking advisory lock, resolves the current effective unit from latest append-only substitution evidence, and then acquires the tenant-and-current-physical-unit advisory lock used by rental inventory/reschedule workflows.

After both locks are held, the service uses PostgreSQL `clock_timestamp()`, re-reads tenant booking/allocation, latest reschedule, and latest substitution. Effective source dates are latest reschedule target when present; otherwise original booking dates. Effective unit is latest substitution target when present; otherwise original booking-time unit.

Cancellation fails closed when the allocation is missing or does not exactly match organization, booking, effective unit, and effective dates.

The final `CONFIRMED -> CANCELLED` mutation remains an exact compare-and-swap over tenant, lifecycle, prior null cancellation time, observed `updatedAt`, customer snapshot identity, source hold, original booking-time unit/type/location, confirmation idempotency key, original immutable booking dates, currency, exact total, original pricing fingerprint/observation, conversion-authority fingerprint, and confirmation time. Rescheduling and substitution both advance `updatedAt`, so stale cancellation decisions fail closed.

Serializable write conflicts are retried a bounded number of times. A retry after successful cancellation is idempotent and does not create duplicate audit evidence.

## Effective financial gate

Cancellation consumes the protected combined settlement contract in [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) while the booking lock is held.

Without a prepared or applied commercial amendment, the effective settlement reduces to the existing bounded booking-price payment/refund ledger. With the one supported applied price-changing amendment, it additionally verifies the retained terminal reschedule, exact uncompensated adjustment evidence, and append-only post-apply effective refunds.

A `PREPARED` commercial amendment is deliberately not treated as terminal settlement. It still owns unresolved commercial authority and may retain adjustment/compensation evidence or become the accepted commercial change. Effective settlement therefore fails closed while any prepared amendment exists. Staff must finish, compensate, cancel, or expire that amendment workflow before booking cancellation can proceed.

The cancellation writer requires all of the following before the terminal lifecycle update:

- no prepared commercial amendment owns unresolved commercial authority;
- the protected settlement read is complete and reconciled;
- the settlement currency and immutable original booking total still match the locked booking;
- `currentNetSettledMinor` is exactly zero; and
- `fullyRefunded` is true.

A positive combined net fails closed even when the original booking-price ledger by itself appears fully refunded. This prevents applied amendment charges from being ignored. For an applied decrease, the retained amendment refund is already source-attributed and cannot be refunded again.

Cancellation audit `beforeData` records whether the financial gate was ordinary booking-price settlement or effective post-amendment settlement, the immutable original total, effective accepted total, exact current net, fully-refunded state, and applied amendment ID when present. It never records card data or payment credentials.

## Security-bond gate

Security-bond money remains separate from booking-price settlement. A retained bond in `COLLECTED` state means customer money is still held under the bond contract, so cancellation must not terminalize the booking while that held-money obligation remains unresolved.

Under the same locked booking transaction, `cancelRentalBooking` reconciles the tenant-owned security-bond requirement, manual collection/release evidence, request fingerprints, and any forfeiture evidence through the minimal operational guard. A collected bond fails closed before the terminal booking update with an explicit instruction to release the bond first. A merely `REQUIRED` bond does not block cancellation because no bond money was collected, and a fully `RELEASED` bond does not block cancellation. Forfeiture is a post-return damage-liability path, when normal booking cancellation is already unavailable, and does not create a pre-pickup cancellation shortcut.

This check does not expose detailed bond money to booking-only readers and does not release, forfeit, collect, or otherwise move bond money. See [rental-security-bond-operational-guards.md](./rental-security-bond-operational-guards.md).

## Database lifecycle and settlement protection

The cancellation lifecycle migration permits only `CONFIRMED` with no cancellation timestamp to transition to `CANCELLED` with a timestamp at or after confirmation. Reopening or clearing cancellation fails closed.

The later substitution lifecycle migration replaces the cancellation trigger's unit-lock lookup so database cancellation serialization also derives the current effective unit from latest substitution history rather than assuming original booking-time unit is still current.

The effective-cancellation settlement migration replaces the older booking-price-only database financial check with the same combined applied-commercial boundary. Under the shared booking advisory lock PostgreSQL still validates supported/reconciled original payment evidence. When no applied amendment exists, original net settlement must be zero exactly as before.

When an applied amendment exists, PostgreSQL independently requires exactly one supported applied amendment, original net settlement still equal to the immutable amendment `beforeTotalMinor`, exact uncompensated manual adjustment evidence, and post-apply effective refund evidence totaling the amendment `afterTotalMinor`. Per-source refund guards continue to prevent over-refunding. The older blanket “all applied amendments block cancellation” trigger is removed because exact zero effective settlement is now enforceable directly.

A later prepared-amendment cancellation guard independently rejects the `CONFIRMED -> CANCELLED` transition while any tenant-owned amendment for that booking remains `PREPARED`. It takes the same booking advisory lock before checking the amendment row, so direct SQL cannot terminalize the booking while the unresolved commercial workflow can still settle, compensate, close, or apply.

The existing security-bond cancellation trigger independently rejects the same lifecycle transition while a successful retained bond collection has no successful release evidence. The application operational guard improves deterministic staff/service behavior but does not replace this database backstop.

Rental inventory guards treat allocations belonging to cancelled bookings as historical rather than live protection. Because cancellation uses the same current physical-unit serialization boundary as availability and rescheduling, no new inventory decision can race between lifecycle release and commit.

Cancellation intentionally does not delete `RentalBookingAllocation`, `RentalBookingReschedule`, `RentalBookingUnitSubstitution`, commercial-amendment, booking-price/effective settlement, or security-bond evidence.

## Audit and retained evidence

A successful staff transition records `booking.rental.cancelled` with actor, tenant, booking, prior state, current effective physical-unit/date allocation, latest reschedule reference, latest substitution reference, effective settlement summary, cancellation timestamp, the normalized staff-supplied cancellation reason, and `inventoryProtectionReleased: true`.

The reason is retained as audit evidence rather than being copied into a mutable booking field. Audit creation remains in the same serializable database transaction as the terminal booking mutation, so an audit-write failure rolls the cancellation back rather than leaving an unaudited lifecycle change.

Immutable customer snapshot, source hold, accepted money, original pricing/conversion evidence, append-only modification evidence, confirmation time, physical allocation, and separate security-bond evidence remain retained. Customer de-identification continues to treat a cancelled rental booking as a retention boundary.

## Staff UX

The cancellation section remains visible while a booking is still `CONFIRMED`, before pickup, has its current allocation, and the actor has `booking:manage` plus `availability:manage`. It is not hidden merely because settlement is non-zero or the actor lacks `payment:read`; this keeps the required next step discoverable without weakening authorization.

The page also reads the minimal booking-authorized security-bond operational projection. While bond money is `COLLECTED`, the cancellation section stays visible but the destructive cancellation control is replaced by an explicit blocker. Actors with payment-read access receive a link to the real security-bond workspace; other actors are told that an authorized payment user must resolve the bond. No bond amount or provider reference is exposed through this projection.

When the actor also has `payment:read`, the server component resolves the protected effective settlement instead of relying only on the original booking-price panel. Reconciled positive combined net shows the exact remaining amount. A prepared amendment or other unreconciled commercial evidence shows a reconciliation blocker and directs staff to resolve the commercial-amendment workflow first. Without `payment:read`, the section exposes no payment amount and states only that authorized settlement verification is required.

When the bond guard is clear, the destructive submit control is rendered only when effective settlement is readable, reconciled, `fullyRefunded`, and exact zero net. Staff must enter a cancellation reason before submitting. HTML `required`/`maxLength` attributes improve usability, while `cancelRentalBooking` independently normalizes and validates the reason server-side and then re-reads the security-bond state plus complete effective settlement under the booking lock. PostgreSQL independently enforces its cancellation guards. A concurrent refund, bond disposition, commercial-amendment state change, custody change, allocation change, or other protected state can still make the final write fail closed.

The action uses explicit confirmation and warns staff not to place payment-card or other sensitive secrets in the reason. Success returns to booking detail; repeated cancellation reports existing terminal state. Permission, unavailable, conflict, validation, and server failures have explicit feedback.

Cancelled details preserve original booking-time evidence, reschedule/substitution history, current effective allocation, commercial evidence, security-bond evidence, and cancellation timestamp while explaining that live inventory protection has ended. The normalized reason remains available through retained audit evidence.

## Deliberate commercial boundary

Rental cancellation releases SF-owned physical inventory only. It does not automatically refund money, release or forfeit a security bond, call a payment provider, calculate a cancellation fee/penalty, create a tax adjustment, notify a customer, reverse fulfillment, or synchronize an external system.

Booking-price manual/offline settlement and source-attributed refunds are implemented separately in [rental-payment-foundation.md](./rental-payment-foundation.md). After an applied commercial amendment, adjustment-aware manual refunds are implemented separately in [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md). Real refund evidence must exist before cancellation; cancellation never manufactures it.

Security-bond disposition remains a separate retained contract documented in [rental-security-bond.md](./rental-security-bond.md). Cancellation-fee policy, automatic refund policy, provider-backed cancellation settlement, and external synchronization remain separate commercial contracts rather than being inferred from cancellation.

Only one applied price-changing rental amendment remains supported. A second/chained price-changing commercial amendment and direct writes to the original booking-price ledger remain blocked. Later same-unit price-neutral reschedules/extensions and same-type/same-location pre-custody unit substitutions remain supported only when they preserve the accepted effective post-amendment amount and satisfy their own fresh inventory, custody, and database authority contracts.

## Validation

`src/server/bookings/rental-booking-cancellation-domain.test.ts` protects cancellation-reason normalization, non-string/empty rejection, and the 1000-character retention boundary.

`scripts/rental-booking-cancellation-source-contract.test.mjs` protects authorization, tenant scope, shared booking/current-unit serialization, latest reschedule/substitution allocation handling, combined effective-settlement authority, exact final mutation predicates, database zero-effective-net enforcement, required reason evidence at direct service call sites, safe reason parsing/validation, route authority, retained audit evidence, and the no-fake-financial-workflow boundary.

`scripts/rental-prepared-amendment-cancellation-guard-source-contract.test.mjs` protects the same-scope gap closed after the applied-amendment cancellation work: the effective settlement reader must fail closed on `PREPARED`, cancellation/service UI must consume that unreconciled state, and PostgreSQL must independently reject direct terminal cancellation while a prepared amendment exists.

`scripts/rental-booking-cancellation-readiness-source-contract.test.mjs` protects staff cancellation discoverability, payment-read privacy, exact-zero effective-settlement submit gating, applied-amendment-aware status copy, and the absence of automatic-refund claims.

`scripts/rental-security-bond-operational-guard-source-contract.test.mjs` protects the booking-authorized bond projection, locked cancellation preflight, existing database backstop, and the no-dead-cancellation-action staff behavior while collected bond money remains held.

`src/server/bookings/rental-booking.integration.ts` contains the guarded disposable-PostgreSQL base cancellation scenario, including an assertion that normalized cancellation reason evidence is retained in the cancellation audit event. Full database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target; prepared/applied amendment and security-bond cancellation scenarios require that same database gate before being claimed as live-verified.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. GitHub Actions are not required or used.
