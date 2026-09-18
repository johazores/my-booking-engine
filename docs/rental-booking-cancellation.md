# Rental booking cancellation

SF implements a staff-only rental booking cancellation lifecycle for the durable confirmed rental booking contract. Cancellation is an inventory-release state transition, not deletion and not a financial workflow. It changes one tenant-owned `CONFIRMED` rental booking to `CANCELLED`, records database cancellation time plus a required normalized cancellation reason in durable audit evidence, retains immutable booking/customer evidence plus append-only reschedule/substitution history and the current physical allocation as historical evidence, and releases that effective physical-unit/date commitment from live availability.

## Authority and tenant scope

`cancelRentalBooking` is server-only. It validates organization, actor, and booking UUIDs and independently requires:

- `booking:manage`, because the operation changes durable booking lifecycle
- `availability:manage`, because cancellation releases protected physical inventory

The staff route derives organization and actor from authenticated server context. The browser may submit only the human cancellation reason. It cannot choose tenant, actor, unit, dates, customer, price, cancellation time, payment authority, or inventory-release authority.

The reason is normalized server-side by trimming outer whitespace, collapsing internal whitespace, requiring a non-empty value, and enforcing the 1000-character retention bound before any lifecycle mutation is attempted.

Every booking, reschedule, and substitution read repeats authenticated `organizationId`. A booking ID from another tenant resolves as unavailable rather than becoming cross-tenant mutation authority.

## Serialization and effective allocation

Cancellation runs in a serializable transaction. It acquires the shared tenant-and-booking advisory lock, resolves the current effective unit from latest append-only substitution evidence, and then acquires the tenant-and-current-physical-unit advisory lock used by rental inventory/reschedule workflows.

After both locks are held, the service uses PostgreSQL `clock_timestamp()`, re-reads tenant booking/allocation, latest reschedule, and latest substitution. Effective source dates are latest reschedule target when present; otherwise original booking dates. Effective unit is latest substitution target when present; otherwise original booking-time unit.

Cancellation fails closed when the allocation is missing or does not exactly match organization, booking, effective unit, and effective dates.

The final `CONFIRMED -> CANCELLED` mutation remains an exact compare-and-swap over tenant, lifecycle, prior null cancellation time, observed `updatedAt`, customer snapshot identity, source hold, original booking-time unit/type/location, confirmation idempotency key, original immutable booking dates, currency, exact total, original pricing fingerprint/observation, conversion-authority fingerprint, and confirmation time. Rescheduling and substitution both advance `updatedAt`, so stale cancellation decisions fail closed.

Serializable write conflicts are retried a bounded number of times. A retry after successful cancellation is idempotent and does not create duplicate audit evidence.

## Database lifecycle protection

The cancellation migration permits only `CONFIRMED` with no cancellation timestamp to transition to `CANCELLED` with a timestamp at or after confirmation. Reopening or clearing cancellation fails closed.

The later substitution lifecycle migration replaces the cancellation trigger's unit-lock lookup so database cancellation serialization also derives the current effective unit from latest substitution history rather than assuming original booking-time unit is still current.

Rental inventory guards treat allocations belonging to cancelled bookings as historical rather than live protection. Because cancellation uses the same current physical-unit serialization boundary as availability and rescheduling, no new inventory decision can race between lifecycle release and commit.

Cancellation intentionally does not delete `RentalBookingAllocation`, `RentalBookingReschedule`, or `RentalBookingUnitSubstitution` rows.

## Audit and retained evidence

A successful staff transition records `booking.rental.cancelled` with actor, tenant, booking, prior state, current effective physical-unit/date allocation, latest reschedule reference, latest substitution reference, cancellation timestamp, the normalized staff-supplied cancellation reason, and `inventoryProtectionReleased: true`.

The reason is retained as audit evidence rather than being copied into a mutable booking field. Audit creation remains in the same serializable database transaction as the terminal booking mutation, so an audit-write failure rolls the cancellation back rather than leaving an unaudited lifecycle change.

Immutable customer snapshot, source hold, accepted money, original pricing/conversion evidence, append-only modification evidence, confirmation time, and physical allocation remain retained. Customer de-identification continues to treat a cancelled rental booking as a retention boundary.

## Staff UX

The cancellation section remains visible while a booking is still `CONFIRMED`, before pickup, has its current allocation, and the actor has `booking:manage` plus `availability:manage`. It is not hidden merely because booking-price settlement is non-zero or the actor lacks `payment:read`; this keeps the required next step discoverable without weakening authorization.

When the actor also has `payment:read`, the page may show the server-derived booking-price cancellation blocker. Reconciled positive net settlement shows the exact remaining amount that must be represented by real retained refund evidence. Unreconciled settlement shows a reconciliation blocker. Without `payment:read`, the section exposes no payment amount and states only that authorized settlement verification is required.

The destructive submit control is rendered only when booking-price settlement is readable, reconciled, and net settlement is zero. Staff must enter a cancellation reason before submitting. HTML `required`/`maxLength` attributes improve usability, while `cancelRentalBooking` independently normalizes and validates the reason server-side and then re-reads and reconciles the complete bounded payment history under the booking lock. PostgreSQL independently enforces its cancellation guards. A concurrent payment/refund, custody change, held security bond, allocation change, or other protected state can still make the final write fail closed.

The action uses explicit confirmation and warns staff not to place payment-card or other sensitive secrets in the reason. Success returns to booking detail; repeated cancellation reports existing terminal state. Permission, unavailable, conflict, validation, and server failures have explicit feedback.

Cancelled details preserve original booking-time evidence, reschedule/substitution history, current effective allocation, and cancellation timestamp while explaining that live inventory protection has ended. The normalized reason remains available through retained audit evidence.

## Deliberate commercial boundary

Rental cancellation releases SF-owned physical inventory only. It does not automatically refund booking-price money, release or forfeit a security bond, call a payment provider, calculate a cancellation fee/penalty, create a tax adjustment, notify a customer, reverse fulfillment, or synchronize an external system.

Booking-price manual/offline settlement and source-attributed refunds are implemented separately in [rental-payment-foundation.md](./rental-payment-foundation.md). Any real refund must be recorded there before cancellation can commit. Security-bond disposition is a separate retained contract documented in [rental-security-bond.md](./rental-security-bond.md). Cancellation-fee policy, automatic refund policy, and provider-backed cancellation settlement remain separate future commercial contracts rather than being inferred from cancellation.

Same-unit price-neutral date rescheduling is implemented separately in [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md), and same-type/same-location physical-unit substitution is implemented in [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md). Unit-type/location changes and price-changing amendments/rescheduling remain separate commercial contracts.

## Validation

`src/server/bookings/rental-booking-cancellation-domain.test.ts` protects cancellation-reason normalization, required-value behavior, and the 1000-character retention boundary.

`scripts/rental-booking-cancellation-source-contract.test.mjs` protects authorization, tenant scope, shared booking/current-unit serialization, latest reschedule/substitution allocation handling, exact final mutation predicates, terminal database lifecycle enforcement, safe reason parsing/validation, route authority, retained audit evidence, and the no-fake-financial-workflow boundary.

`scripts/rental-booking-cancellation-readiness-source-contract.test.mjs` protects staff cancellation discoverability, payment-read privacy, zero-settlement submit gating, partial-payment-aware status copy, and the removal of stale pre-payment-workflow messaging.

`src/server/bookings/rental-booking.integration.ts` contains the guarded disposable-PostgreSQL cancellation scenario. Full database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. GitHub Actions are not required or used.
