# Rental security-bond operational guards

A retained rental security-bond requirement is separate from booking-price settlement, but its current disposition affects whether staff may hand over physical custody or terminate a pre-pickup booking.

## Operational projection

`readRentalBookingSecurityBondGuard` is a booking-read-authorized operational projection. It verifies the tenant-owned booking, reloads the retained security-bond requirement, collection/release evidence, and any forfeiture evidence, validates manual request fingerprints, and reconciles the existing security-bond domain state without returning provider references, amounts, or other payment details to the booking page.

The projection reports only whether a requirement exists, the derived lifecycle state, whether pickup is blocked, and whether cancellation is blocked. Detailed security-bond amounts and settlement evidence continue to require the existing payment-read authority in the dedicated security-bond workspace.

## Pickup boundary

A booking with no security-bond requirement preserves normal pickup authority. When a requirement exists, a new pickup is allowed only while the retained bond state is exactly `COLLECTED`.

The fulfillment writer checks that state only for a fresh `PICKED_UP` event. The writer checks run under the existing tenant/booking advisory lock and before new custody evidence is inserted. Existing idempotent pickup replay remains evidence verification, and `RETURNED` is deliberately not blocked by this pre-pickup rule.

The staff booking page removes the **Record pickup** primary action while the bond is `REQUIRED`, `RELEASED`, or otherwise not actively collected. Actors with payment-read access receive a link to the real security-bond workspace; other booking operators are told to involve an authorized payment user instead of receiving a dead action.

## Cancellation boundary

A `COLLECTED` security bond represents customer money still held outside the booking-price ledger. Cancellation therefore remains blocked until that bond has a terminal disposition that releases the held amount from the booking's pre-pickup lifecycle.

The cancellation writer reads the same reconciled guard under the locked booking transaction before the terminal `RentalBooking` update. The booking page suppresses the cancellation control while the guard reports held bond money and points authorized payment readers to the existing release workflow.

A merely `REQUIRED` bond does not itself block cancellation because no bond money has been collected. A fully `RELEASED` bond also does not block cancellation. Forfeiture remains a post-return damage-liability path and does not create a pre-pickup cancellation shortcut.

## Database authority

PostgreSQL remains the independent final authority. The existing security-bond migration already rejects direct `PICKED_UP` inserts unless an existing requirement is actively collected and rejects direct booking cancellation while collected bond money remains unreleased.

The application guards improve deterministic server errors and remove dead staff actions; they do not weaken or replace those database backstops. A concurrent bond lifecycle change after page render is rechecked by the locked writer and then by PostgreSQL at persistence time.

## Deliberate boundaries

This operational guard does not move, collect, release, or forfeit money. It does not create a new bond requirement, recollect a released bond, invent card authorization, or combine security-bond money with booking-price settlement.

The current one-requirement, one-full-collection, one-terminal-disposition contract remains unchanged. Provider-backed bonds, partial releases, partial damage offsets, replacement/rebond workflows, and customer self-service remain separate acceptance criteria.

## Validation

`scripts/rental-security-bond-operational-guard-source-contract.test.mjs` protects the tenant-scoped operational projection, locked pickup and cancellation preflight checks, the existing PostgreSQL backstops, and no-dead-action staff behavior.

Full repository validation remains `npm run validate` under the Node version declared by `package.json`. Live database validation remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used.
