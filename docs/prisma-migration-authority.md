# Prisma migration authority

SF uses a multi-file Prisma schema under `prisma/`, while checked-in PostgreSQL migrations remain the deployed database history. Both representations must describe the same Prisma-supported authority before drift can be considered clean.

## Current reconciliation rule

When a checked-in migration creates a Prisma-supported unique index, normal index, or foreign key with an explicit production name, the Prisma model must preserve the same database name with `map:` where Prisma would otherwise derive a different name. Tenant-bound composite foreign keys must keep the same tenant/resource tuple; replacing them with an ID-only relation would weaken the schema contract even when application repositories already scope queries correctly. Prisma relation cardinality must also preserve database uniqueness, including one-to-one checkout/payment, hold/public-owner, booking/public-owner, commercial-amendment target-hold, invoice-preparation/issued-invoice, adjustment/payment, adjustment/amendment, adjustment/target-pricing, and predecessor/successor links.

The current reconciliation covers migration-backed names and cross-fragment relations for:

- non-hospitality tenant roots for tours, appointments, and rentals, including compact physical mappings for the rental availability-block, rate-period, and availability-hold lookup indexes;
- hospitality amenities, property/room-type image lookups, room-type/rate-plan assignments, restriction scope/date lookups, and availability-window composite authority, including compact PostgreSQL-safe foreign-key/index mappings while preserving organization/property/room-type/rate-plan tenant tuples;
- public booking principal ownership, hold/booking ownership, and Stripe Checkout organization/booking linkage;
- payment transaction organization, booking, commercial-amendment attribution, and provider-reference lifecycle indexes;
- commercial-amendment organization/booking/property/current-target room type/current-target rate plan/target-hold authority, including compact PostgreSQL-safe mappings for the current-room/current-rate foreign keys and booking/status/expiry index;
- commercial pricing evidence organization/booking/property/room type/rate plan/amendment attribution;
- invoice issuer, preparation, sequence, issued-invoice, and adjustment-note organization/booking/user authority, including the compact adjustment-note jurisdiction/type/sequence unique-index mapping;
- immutable invoice, issued-invoice, adjustment-note, payment, amendment, target-pricing, and predecessor-chain evidence; and
- supplier reservation operation/attempt integration and reservation authority plus their explicit idempotency, provider-reference, sequence, and lookup indexes.

The root-side Prisma models now expose the inverse relations needed by those checked-in foreign keys. This includes `Organization`, `HospitalityBooking`, `HospitalityAvailabilityHold`, `HospitalityProperty`, `HospitalityRoomType`, `HospitalityRatePlan`, and `User`. Supplier reservation operation/attempt relations retain `organizationId` in their composite foreign-key tuples; do not replace them with ID-only relations. Do not remove or weaken database constraints to make Prisma validation easier.

This source-level reconciliation is deliberately not a declaration that the entire migration history is drift-clean. A new migration or an older migration outside these covered contracts can still introduce Prisma-supported authority that needs representation, and raw PostgreSQL checks/exclusion constraints remain database-only authority where Prisma cannot model them.

## Validation boundary

`scripts/prisma-schema-contract.test.mjs` protects previously reconciled migration names and cross-fragment relation tuples. `scripts/prisma-root-relation-authority.test.mjs` protects the root-side relation coverage and one-to-one cardinality added by the root reconciliation. `scripts/supplier-reservation-postgresql-identifier-portability-source-contract.test.mjs` protects the supplier operation/attempt physical-name mappings and tenant-bound relation tuples after the PostgreSQL identifier portability repair. `scripts/hospitality-commercial-amendment-postgresql-identifier-portability-source-contract.test.mjs` protects the compact commercial-amendment physical names and the unchanged tenant-bound current-room/current-rate tuples. `scripts/rental-inventory-postgresql-identifier-portability-source-contract.test.mjs` protects the compact rental availability/rate lookup names and unchanged tenant-bound unit/unit-type tuples. `scripts/hospitality-invoice-postgresql-identifier-portability-source-contract.test.mjs` protects the compact adjustment-note numbering index and verifies that all explicit invoice-fragment physical names fit PostgreSQL identifier limits. `scripts/hospitality-inventory-postgresql-identifier-portability-source-contract.test.mjs` protects compact hospitality inventory physical names and the unchanged composite tenant tuples. These are dependency-free source contracts, not substitutes for Prisma validation.

A production-complete schema reconciliation still requires the repository Node 24 toolchain plus:

```bash
npm run prisma:validate
npm run prisma:generate
npm run test:database
npm run validate
```

`npm run test:database` must use the explicitly confirmed disposable PostgreSQL target described in `docs/development-guide.md`. A passing source contract must never be reported as a passing Prisma drift or live database check.

GitHub Actions are intentionally not used for this validation.

## Stripe refund reference database integrity

`prisma/migrations/20261028082500-stripe-refund-reference-uniqueness/migration.sql` adds a PostgreSQL-only partial unique index for exact Stripe `re_`-prefixed provider references per organization. The predicate uses `left("providerReference", 3) = 're_'`, not SQL `LIKE 're_%'` (where `_` would be a wildcard). It covers every payment kind and status; `pi_*` authorization/capture references remain shareable within their legitimate booking source. The existing Prisma normal lookup index remains in place. A preflight fails migration when historical duplicate refund references exist and does not rewrite evidence.

The partial expression index is deliberately raw PostgreSQL authority rather than a broad Prisma `@@unique`. `scripts/stripe-refund-reference-uniqueness-contract.test.mjs` checks the checked-in SQL and Prisma lookup contract; `src/server/payments/stripe-refund.integration.ts` checks same-booking, cross-booking, cross-kind duplicate rejection, and provider namespace separation through real PostgreSQL. The latter remains unexecuted until the disposable database gate is available. This is not a concurrent cross-booking `pi_*` ownership constraint, and it does not replace live provider verification.

## Stripe PaymentIntent cross-booking database integrity

`prisma/migrations/20261028092000-stripe-payment-intent-booking-ownership/migration.sql` introduces a PostgreSQL `btree_gist` exclusion constraint on tenant, exact `pi_` PaymentIntent reference, and *different* booking identity. This is not a unique reference index: one booking may legitimately retain authorization and capture rows for the same PaymentIntent, including historical statuses. A different booking in the same tenant cannot adopt that PaymentIntent, including concurrent writes, amendment-owned rows, and claim-to-provider-reference updates. The same reference remains independent across tenants. Stripe Refund `re_` identity retains its separate partial unique index.

The migration refuses historical `pi_` references assigned to more than one booking within a tenant and does not alter ledger evidence. It installs the trusted `btree_gist` extension, which requires database `CREATE` privilege. Review existing duplicate evidence, extension availability, and the `ALTER TABLE ADD CONSTRAINT` write lock before production deployment. The exclusion constraint is PostgreSQL-only authority; the Prisma provider-reference lookup index remains intact.

`scripts/stripe-payment-intent-booking-ownership-contract.test.mjs` protects SQL/schema intent. The guarded `stripe-payment.integration.ts` scenarios exercise same-booking sharing, cross-kind/cross-booking rejection, internal-claim update rejection, and concurrent writes. These are checked-in scenarios, **not evidence that the migration ran**. Node 24, disposable PostgreSQL migration/integration execution, and live Stripe verification remain outstanding. Existing service-side foreign-owner checks remain necessary defense in depth.

## Stripe PaymentIntent commercial-amendment scope integrity

`prisma/migrations/20261028102000-stripe-payment-intent-amendment-ownership/migration.sql` adds a second PostgreSQL `btree_gist` exclusion constraint for the same tenant, booking, and real Stripe `pi_` PaymentIntent reference. It rejects distinct commercial settlement scopes: a base-booking payment cannot share the intent with an amendment, and two amendments cannot share it with each other. Authorization and capture rows within the same base or same amendment scope remain valid. The prior cross-booking constraint is retained.

The nullable amendment ID is cast to text and coalesced to the non-UUID marker `base-booking`, avoiding the collision risk of a synthetic UUID sentinel. Historical mixed-scope evidence fails a read-only preflight with SQLSTATE `23P01` and must be reviewed before deployment. This is PostgreSQL-only authority, not a Prisma `@@unique` rule. Deployment requires the prior `btree_gist` migration, review of the table lock and historical data, and disposable-PostgreSQL validation.

`scripts/stripe-payment-intent-amendment-ownership-contract.test.mjs` protects the SQL and regression-source contract. The guarded `stripe-payment.integration.ts` suite includes base-versus-amendment, distinct amendments, same-amendment authorization/capture sharing, claim binding, ownership updates, provider namespace separation, and concurrent-writer scenarios. These tests have not been run against PostgreSQL in this environment; full Node 24, Prisma, and database gates remain open.

## Physical Stripe reference constraint verification

The guarded `src/server/payments/stripe-reference-database-constraints.integration.ts` suite reads PostgreSQL catalogs after the full migration chain is deployed. It verifies the installed `btree_gist` extension, the exact partial Stripe `re_` unique index, both `pi_` exclusion constraints, their tenant/resource key order, index access methods, validated/ready/live status, and provider/reference predicates. This catches missing or disabled raw PostgreSQL authority that Prisma schema drift inspection cannot fully represent. The suite is mandatory in `scripts/run-database-tests.mjs` and is read-only; the existing direct-write concurrency/ownership tests remain necessary to prove behavior. **No catalog check has been run against PostgreSQL in the current environment.**
