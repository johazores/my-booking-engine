# Development Guide

## Runtime

Use Node.js 24 LTS. `.nvmrc` currently pins `24.20.0`.

`npm run test:database` checks the Node runtime before inspecting connection targets or running Prisma/migrations. It requires Node `>=24.20.0 <25`, matching `package.json`; an unsupported Node version fails closed before any database command. The dependency-free runtime preflight tests can run under an older local Node version, but they do not validate the Prisma schema or execute PostgreSQL migrations.

## Core versions

- Next.js 16.3.3
- React 19.2.8
- TypeScript 6.0.3
- Prisma ORM 7.10
- `@prisma/adapter-pg` 7.10
- PostgreSQL via `pg` 8.23

TypeScript 7 is newer, but this baseline intentionally uses the mature TypeScript 6 patch line until compatibility across Next.js, ESLint, and Prisma is verified as one toolchain.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run prisma:generate
npm run dev
```

Create a local PostgreSQL database and update `DATABASE_URL` before running database-backed commands.

## Database bootstrap

The initial tenant migration is checked in under `prisma/migrations/20260830043000_initial_tenant_foundation`.

For a new local PostgreSQL database:

```bash
npm run prisma:generate
npm run prisma:validate
npm run db:deploy
npm run db:status
npm run db:drift
```

`db:status` verifies that the checked-in migration history matches the database migration table. `db:drift` compares the complete multi-file Prisma schema to the configured database and exits non-zero when Prisma-supported schema drift exists. SF configures `schema: 'prisma'`, so drift validation must point at the `prisma` directory rather than only `prisma/schema.prisma`; otherwise domain fragments such as inventory and supplier persistence can be omitted from the comparison.

Prisma-supported tenant-root foreign keys must also be represented in the multi-file schema, including their checked-in constraint names when migrations name those constraints explicitly. A database foreign key that exists only in migration SQL but is absent from Prisma relation metadata can make an otherwise intentional production constraint appear as schema drift.

Prisma schema diffing covers Prisma-supported database features only. Raw SQL constraints that Prisma does not model are verified by the guarded PostgreSQL integration scenarios and their direct database assertions; a clean `db:drift` result alone is not evidence that those custom constraints exist.

For an isolated development database where Prisma should manage development migration state:

```bash
npm run db:migrate
```

After applying the migration, verify migration status and drift before marking the live-database checklist items complete. Never point development migration commands at production.

## Database integration tests

Database isolation tests must use a dedicated disposable PostgreSQL database through `TEST_DATABASE_URL`. The runner requires an explicit safety acknowledgement, validates the target before making any database-backed call, validates the complete multi-file Prisma schema, regenerates the current Prisma client, applies checked-in migrations, verifies migration status and Prisma-supported schema drift, then runs the real tenant repositories against two separate tenants.

```bash
# example only; use your own disposable local test database
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sf_test?schema=public"
export SF_DATABASE_TEST_CONFIRM="sf-disposable-test-database"
npm run test:database
```

The acknowledgement is intentionally verbose so an accidental environment variable or copied production connection string is less likely to start database integration work. `TEST_DATABASE_URL` must use PostgreSQL, name a non-maintenance database, and target a different host/port/database identity from `DATABASE_URL`. The safety comparison deliberately ignores credentials, URL query parameters, PostgreSQL protocol aliases, and omission of the default port, so alternate connection-string formatting cannot make the same database appear different. If `DATABASE_URL` is present but malformed, the test runner fails closed rather than skipping the comparison. PostgreSQL maintenance/template databases (`postgres`, `template0`, and `template1`) are rejected as integration-test targets.

Database-target comparison treats common local loopback hostname spellings (including reserved `*.localhost` subdomains, Linux `localhost6`/`localhost6.localdomain6` aliases, unspecified IPv6 addresses that can connect locally, and legacy numeric IPv4 forms such as hexadecimal, octal, and integer hosts) as the same server. It also canonicalizes **all** IPv4-mapped IPv6 hosts to their IPv4 identity, including non-loopback addresses, so `[::ffff:192.168.1.1]` and `192.168.1.1` cannot bypass the test/application database separation check. It rejects explicit TCP port zero, URL query parameters that could override host/port/database/service, and missing hostnames for both test and application targets. The runner fails closed for malformed encoded database names. This is defense in depth, not proof of physical server separation: DNS aliases, proxies, and tunnels can still make distinct hostnames reach the same database. Use a dedicated disposable database and verify its destination before setting the confirmation value.

These checks reduce accidental misuse but do not make arbitrary databases safe. `TEST_DATABASE_URL` must still point only at a disposable database created for SF tests. Do not point it at production or any shared database containing valuable data.

The guard also treats common Linux IPv4 `localhost4` aliases as local, and fails closed for database names containing control bytes, slash/backslash path separators, or more than 63 UTF-8 bytes (the standard PostgreSQL identifier limit). This avoids ambiguous URL path normalization and database-name truncation during target comparison. These restrictions apply to both test and application URLs only for the disposable test runner; they do not change production connection parsing.

The runner also compares the test target with every `DATABASE_URL` found in local `.env`, `.env.local`, and their development/production/test variants. It parses these files without loading `TEST_DATABASE_URL` or `SF_DATABASE_TEST_CONFIRM` into the process, so an environment file cannot silently provide the explicit test confirmation. Unreadable local environment files and malformed application targets fail closed. Environment-file comparison is defense in depth; DNS aliases and tunnels still require manual destination verification.

The database runner discovers every `src/server/**/*.integration.ts` file in stable path order, so newly added database regression suites cannot be silently skipped. The 50 existing critical suites remain a mandatory baseline manifest: the runner fails closed if one disappears or is renamed without updating the manifest. Discovery also fails when no suites exist, rejects symbolic-link test roots, and does not traverse symbolic links. The dependency-free discovery tests do not replace disposable PostgreSQL execution.

The tenant isolation integration test creates Tenant A and Tenant B with separate users and memberships, verifies Tenant A cannot retrieve Tenant B organization or membership data, and verifies suspended users/memberships immediately lose tenant access. It removes the records it creates when the test finishes.

The manual hospitality payment, Australian invoice preparation/issuance, and invoice-number-sequence integration suites also register tenant-scoped cleanup before fixture creation, using preassigned tenant/user IDs. Their existing dependency-ordered teardown is reused on normal completion and partial setup failure, with a completed-cleanup guard to avoid duplicate destructive work. This is source-level cleanup hardening, not proof of live database execution.

Rental inventory, availability-hold, booking, source-evidence, and manual-payment integration suites use PostgreSQL `clock_timestamp()` to derive future relative calendar windows. This prevents live hold/booking assertions from expiring as fixed fixture dates pass, while preserving intentional overlap, rate-period, and historical immutability probes. The dependency-free date contract test is not evidence that these suites have run against PostgreSQL.

The five non-financial rental database integration suites for inventory integrity, inventory management, holds, booking lifecycle, and booking source evidence now register tenant-scoped teardown before their first fixture write. They preassign root tenant/user IDs so a partial setup failure can be cleaned up without relying on successful create responses, and reuse dependency-ordered cleanup after both success and failure. This is guarded by `scripts/rental-database-fixture-lifecycle-contract.test.mjs` and is not a claim of live PostgreSQL execution. Rental manual-payment and security-bond suites are intentionally excluded from this deletion strategy: their retained financial ledgers have append-only triggers and restrictive foreign keys, so ordinary teardown cannot safely delete them. They require a separate isolated database lifecycle strategy rather than disabling integrity guards or deleting unrelated tenant records.

The Stripe payment, refund, and signed-refund-webhook database integration suites register cleanup before their first fixture write. They preassign unique user and organization IDs so partial setup failures can still be cleaned up after the test, even when an insert committed but its response failed. Cleanup is scoped to those IDs, deletes tenant-owned records in dependency order, and never deletes shared tenant data. The Stripe payment suite separately restores its mocked fetch in `finally`. This cleanup does not replace the requirement to use an explicitly disposable PostgreSQL target.

## Validation

Before considering a coherent slice complete, run the relevant available checks:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run validate` executes that schema-first sequence so TypeScript and the production build cannot silently consume a stale generated Prisma client after a multi-file schema change.

When a disposable PostgreSQL test database is available, also run:

```bash
npm run test:database
```

When database behavior is added, include appropriate schema/migration validation and tests for important domain rules. Tests requiring real database isolation must run against an isolated PostgreSQL test database, not a shared or production database.

## Code organization

- `app/` — Next.js routes and layouts
- `src/components/` — reusable product components
- `src/server/` — server-only application/data-access code
- `prisma/` — database schema/migrations
- `docs/` — architecture and product engineering documentation
- `scripts/` — local engineering/validation entrypoints

Keep business rules out of UI components. Keep route handlers thin. Avoid generic utility dumping grounds and unnecessary deep nesting.

## Naming

Use kebab-case for project-created files and folders. Framework-required names such as `page.tsx`, `layout.tsx`, and `route.ts` are allowed.

## Repository automation

Do not add `.github/workflows` or GitHub Actions. Validation is intentionally local unless this policy is explicitly changed later.
