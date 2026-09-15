# Rental booking write failure handling

SF normalizes expected persistence races and database guard failures at the rental booking service boundary so staff workflows fail closed as booking conflicts instead of leaking raw Prisma failures into route-level server-error handling.

This contract applies to the three durable rental booking write paths that currently exist: hold-to-booking confirmation, terminal cancellation, and same-unit price-neutral rescheduling.

## Classification contract

`classifyRentalBookingWriteError` is a small server-domain helper. It recognizes only Prisma conditions whose meaning is stable for the current rental persistence contract:

- `P2034` is a retryable transaction write/serialization conflict.
- `P2002` is a uniqueness conflict. Confirmation and reschedule may retry it because both have tenant-scoped idempotency records that are re-read on the next transaction attempt; cancellation does not create an idempotency row and treats an unexpected uniqueness conflict as a conflict immediately.
- `P2003` and `P2004` are fail-closed persistence conflicts. They cover relation/constraint failures raised when durable tenant, lifecycle, inventory, or append-only database invariants reject a write.
- every other error remains unknown and is rethrown unchanged so infrastructure/programming failures are not mislabeled as business conflicts.

Each service still limits retries to three transaction attempts. When a retryable condition persists through the final attempt, the service converts it to its existing rental booking domain conflict type instead of rethrowing raw Prisma `P2034`/`P2002`. Route handlers already map those domain conflicts to explicit `conflict` feedback.

## Why uniqueness retry is opt-in

Retrying `P2002` globally would be unsafe. The confirmation writer can encounter a concurrent tenant-scoped booking idempotency/hold uniqueness race, and the reschedule writer can encounter its tenant-scoped append-only reschedule idempotency race. Both re-enter the transaction through an existing-record replay check.

Cancellation has no equivalent record-creation replay boundary, so it does not opt into unique-conflict retry.

## Security and commercial boundaries

Error normalization does not relax tenant scope, authorization, advisory locks, exact compare-and-swap predicates, append-only evidence, or database constraints. It changes only how already-rejected persistence races are surfaced after the transaction aborts.

The helper contains no provider behavior and no payment, deposit, refund, fulfillment, or customer self-service semantics. Unknown database/infrastructure failures remain server failures rather than being hidden as user-correctable conflicts.

## Validation

`src/server/bookings/rental-booking-write-errors.test.ts` protects the Prisma-code classification behavior.

`scripts/rental-booking-write-error-source-contract.test.mjs` protects adoption across all three current rental booking writers, bounded retry semantics, route-level conflict mapping, and the absence of duplicated local Prisma-code classifiers.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
