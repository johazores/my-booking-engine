# Rental late-return settlement

SF supports retained full-value manual/offline settlement evidence for a previously retained `FEE_ASSESSED` late-return assessment.

The assessment remains the commercial authority. Settlement is a separate append-only payment evidence stream and is separate from the immutable rental booking price, customer damage settlement, and security-bond disposition.

## Enabled contract

The current production boundary supports at most:

- one successful full-value manual/offline payment for the exact retained late-return fee; and
- one successful full-value manual/offline refund tied to that exact retained payment source.

`WAIVED` assessments cannot be settled because they retain no amount due. The browser never supplies tenant identity, actor identity, currency, amount, source payment, or idempotency authority.

The manual provider records evidence for money that already moved outside SF. It does not charge a card, debit an account, contact a payment processor, or pretend provider-backed collection occurred.

## Authorization and tenant scope

Reads require both `booking:read` and `payment:read`. Writes require both `booking:manage` and `payment:manage`.

Every assessment and transaction lookup repeats the authenticated `organizationId`, booking ID, and assessment ID. Writes serialize on the shared tenant/booking advisory lock and use bounded serializable retries. Retained reads use a repeatable-read snapshot.

`RentalLateReturnSettlementTransaction` also carries a direct composite `(bookingId, organizationId)` foreign key to `RentalBooking` in addition to its tenant-owned assessment relation. This makes the retained booking identifier database-enforced referential evidence rather than a denormalized value protected only by application/trigger checks.

## Idempotency and request evidence

Payment and refund idempotency keys are derived server-side from the assessment ID, operation, and normalized real-world manual reference. Each row also retains a SHA-256 request fingerprint over the tenant, booking, assessment, operation, provider/source references, currency, and exact amount.

PostgreSQL independently requires:

- append-only successful manual `OFFLINE_PAYMENT` or `REFUND` evidence;
- the exact tenant-owned `FEE_ASSESSED` source assessment;
- exact assessment currency and positive `feeMinor`;
- operation-specific deterministic idempotency-key shape;
- a refund source that matches retained payment evidence; and
- database-authored `createdAt` chronology using `clock_timestamp()`.

## Manual-reference isolation

A real-world manual reference must identify only one rental settlement row in an organization. The shared PostgreSQL advisory-lock guard now spans booking-price payments, customer-damage settlement, security-bond settlement, and late-return settlement. The late-return service also checks all four ledgers under the same shared reference-lock namespace before recording new evidence.

This prevents one external receipt/refund identifier from being represented as multiple commercial events across separate rental ledgers, including concurrent inserts.

## Staff workflow

A retained fee assessment exposes a separate settlement card on booking detail. Authorized staff can record the exact full fee only after it was actually received outside SF. Once paid, they can record one exact full refund only after that refund actually occurred outside SF. Retained rows are read-only.

A waived assessment shows no settlement action because no fee authority exists.

## Deliberate boundaries

This contract does not implement partial payment, partial refund, split tender, card authorization/capture, Stripe or other provider-backed late-return collection, automatic charging, invoices, collection reminders, customer self-service, or an automatic late-fee policy. It also does not alter custody, allocation dates, the accepted rental booking price, damage liability, or security-bond evidence.

Those are separate production workflows with different authority and recovery requirements.

## Validation

`src/server/payments/rental-late-return-settlement-domain.test.ts` covers unpaid/paid/refunded reconciliation, exact-value/source/chronology failure cases, and deterministic operation-bound idempotency/fingerprints.

`scripts/rental-late-return-settlement-source-contract.test.mjs` protects tenant/permission scope, bounded settlement history, serializable locking, manual-provider capability use, PostgreSQL source authority, append-only/database-time evidence, four-ledger manual-reference isolation, real staff actions, safe form parsing, and the deliberate no-fake-provider boundary.

`scripts/rental-commercial-booking-integrity-source-contract.test.mjs` protects the direct tenant-owned booking foreign key on retained late-return settlement evidence.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Live migration/trigger execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
