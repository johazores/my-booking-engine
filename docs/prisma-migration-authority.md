# Prisma migration authority

SF uses a multi-file Prisma schema under `prisma/`, while checked-in PostgreSQL migrations remain the deployed database history. Both representations must describe the same Prisma-supported authority before drift can be considered clean.

## Current reconciliation rule

When a checked-in migration creates a Prisma-supported unique index, normal index, or foreign key with an explicit production name, the Prisma model must preserve the same database name with `map:` where Prisma would otherwise derive a different name. Tenant-bound composite foreign keys must keep the same tenant/resource tuple; replacing them with an ID-only relation would weaken the schema contract even when application repositories already scope queries correctly.

The current reconciliation pass covers migration-backed names and cross-fragment relations that can be expressed entirely inside the existing domain fragments for:

- public booking principal ownership and Stripe Checkout linkage;
- payment provider-reference lifecycle and lookup indexes, including the intentionally removed historical provider-reference uniqueness;
- commercial-amendment pricing-evidence attribution; and
- invoice, issued-invoice, adjustment-note, payment, amendment, and predecessor-chain evidence.

The database migrations still contain additional foreign keys into root models such as `Organization`, `HospitalityBooking`, `HospitalityAvailabilityHold`, `HospitalityProperty`, `HospitalityRoomType`, `HospitalityRatePlan`, and `User`. Those are still migration authority until the corresponding opposite Prisma relation fields are reconciled in the root schema and the complete Prisma 7.10/PostgreSQL drift gate is run. Do not remove or weaken the database constraints to make Prisma validation easier.

## Validation boundary

`scripts/prisma-schema-contract.test.mjs` protects the exact migration-backed names and cross-fragment relation tuples that have already been reconciled. It is a dependency-free source contract, not a substitute for Prisma validation.

A production-complete schema reconciliation still requires the repository Node 24 toolchain plus:

```bash
npm run prisma:validate
npm run prisma:generate
npm run test:database
npm run validate
```

`npm run test:database` must use the explicitly confirmed disposable PostgreSQL target described in `docs/development-guide.md`. A passing source contract must never be reported as a passing Prisma drift or live database check.

GitHub Actions are intentionally not used for this validation.
