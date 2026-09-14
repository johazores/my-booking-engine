# Prisma migration authority

SF uses a multi-file Prisma schema under `prisma/`, while checked-in PostgreSQL migrations remain the deployed database history. Both representations must describe the same Prisma-supported authority before drift can be considered clean.

## Current reconciliation rule

When a checked-in migration creates a Prisma-supported unique index, normal index, or foreign key with an explicit production name, the Prisma model must preserve the same database name with `map:` where Prisma would otherwise derive a different name. Tenant-bound composite foreign keys must keep the same tenant/resource tuple; replacing them with an ID-only relation would weaken the schema contract even when application repositories already scope queries correctly. Prisma relation cardinality must also preserve database uniqueness, including one-to-one checkout/payment, hold/public-owner, booking/public-owner, commercial-amendment target-hold, invoice-preparation/issued-invoice, adjustment/payment, adjustment/amendment, adjustment/target-pricing, and predecessor/successor links.

The current reconciliation covers migration-backed names and cross-fragment relations for:

- non-hospitality tenant roots for tours, appointments, and rentals;
- public booking principal ownership, hold/booking ownership, and Stripe Checkout organization/booking linkage;
- payment transaction organization, booking, commercial-amendment attribution, and provider-reference lifecycle indexes;
- commercial-amendment organization/booking/property/current-target room type/current-target rate plan/target-hold authority;
- commercial pricing evidence organization/booking/property/room type/rate plan/amendment attribution;
- invoice issuer, preparation, sequence, issued-invoice, and adjustment-note organization/booking/user authority; and
- immutable invoice, issued-invoice, adjustment-note, payment, amendment, target-pricing, and predecessor-chain evidence.

The root-side Prisma models now expose the inverse relations needed by those checked-in foreign keys. This includes `Organization`, `HospitalityBooking`, `HospitalityAvailabilityHold`, `HospitalityProperty`, `HospitalityRoomType`, `HospitalityRatePlan`, and `User`. Do not remove or weaken database constraints to make Prisma validation easier.

This source-level reconciliation is deliberately not a declaration that the entire migration history is drift-clean. A new migration or an older migration outside these covered contracts can still introduce Prisma-supported authority that needs representation, and raw PostgreSQL checks/exclusion constraints remain database-only authority where Prisma cannot model them.

## Validation boundary

`scripts/prisma-schema-contract.test.mjs` protects previously reconciled migration names and cross-fragment relation tuples. `scripts/prisma-root-relation-authority.test.mjs` protects the root-side relation coverage and one-to-one cardinality added by the root reconciliation. These are dependency-free source contracts, not substitutes for Prisma validation.

A production-complete schema reconciliation still requires the repository Node 24 toolchain plus:

```bash
npm run prisma:validate
npm run prisma:generate
npm run test:database
npm run validate
```

`npm run test:database` must use the explicitly confirmed disposable PostgreSQL target described in `docs/development-guide.md`. A passing source contract must never be reported as a passing Prisma drift or live database check.

GitHub Actions are intentionally not used for this validation.
