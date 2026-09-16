# Rental booking write failure handling

SF normalizes expected persistence races and database guard failures at the rental commercial service boundary so staff workflows fail closed as explicit conflicts instead of leaking raw Prisma failures into route-level server-error handling.

This contract currently applies to seven durable rental write services:

1. hold-to-booking confirmation;
2. terminal cancellation;
3. price-neutral rescheduling;
4. same-type/same-location physical-unit substitution;
5. pickup/return fulfillment evidence;
6. early-return inventory release; and
7. manual rental payment/refund evidence.

## Classification contract

`classifyRentalBookingWriteError` is a small server-domain helper. It recognizes only Prisma conditions whose meaning is stable for the current rental persistence contract:

- `P2034` is a retryable transaction write/serialization conflict.
- `P2002` is a uniqueness conflict. A service opts into retry only when a tenant-scoped, server-derived idempotent replay boundary exists for the durable record that could have won the race.
- `P2003` and `P2004` are fail-closed persistence conflicts. They cover relation/constraint failures raised when durable tenant, lifecycle, inventory, append-only, custody, settlement, or effective-allocation database invariants reject a write.
- every other error remains unknown and is rethrown unchanged so infrastructure/programming failures are not mislabeled as business conflicts.

Each service limits retries to three transaction attempts. When a retryable condition persists through the final attempt, the service converts it to its own explicit rental domain conflict type instead of rethrowing raw Prisma `P2034`/`P2002`. Route handlers map those domain conflicts to explicit conflict feedback.

## Why uniqueness retry is opt-in

Retrying `P2002` globally would be unsafe.

Confirmation, reschedule, unit substitution, fulfillment, early-return inventory release, and manual payment/refund writes all have durable tenant-scoped replay evidence whose identity is derived server-side. After a uniqueness race, the next bounded transaction attempt re-enters through that existing-record boundary and must validate that the retained evidence still matches the authoritative booking, inventory, custody, or settlement state before returning idempotent success.

Cancellation has no equivalent record-creation replay boundary. It changes the existing booking terminally and therefore does not opt into unique-conflict retry.

The replay rule is intentionally stronger than “the idempotency key exists.” Fulfillment replay re-derives the retained pre-pickup reschedule/substitution assignment before accepting an existing pickup/return event. Early-return release replay re-derives that assignment, verifies the exact linked `RETURNED` event and timestamp, and verifies the shortened live allocation. Rental payment/refund replay independently validates durable source/provider/currency/amount and complete settlement evidence.

## Security and commercial boundaries

Error normalization and replay validation do not relax tenant scope, authorization, advisory locks, deterministic unit lock ordering, exact compare-and-swap predicates, append-only evidence, stale-authority checks, provider adapters, or database constraints. They change only how already-rejected persistence races are retried and surfaced after a transaction aborts.

The shared classifier contains no provider behavior and does not invent deposit, fee, damage, delivery, or customer self-service semantics. Unknown database/infrastructure failures remain server failures rather than being hidden as user-correctable conflicts.

## Validation

`src/server/bookings/rental-booking-write-errors.test.ts` protects the Prisma-code classification behavior.

`scripts/rental-booking-write-error-source-contract.test.mjs` protects adoption across all seven current durable rental write services, bounded retry semantics, opt-in uniqueness retry, and route-level conflict mapping.

`scripts/rental-booking-fulfillment-source-contract.test.mjs` and `scripts/rental-early-return-inventory-release-source-contract.test.mjs` additionally protect replay revalidation for custody and early-return inventory evidence.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
