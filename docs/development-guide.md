# Development Guide

## Runtime

Use Node.js 24 LTS. `.nvmrc` currently pins `24.20.0`.

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

`db:status` verifies that the checked-in migration history matches the database migration table. `db:drift` compares the Prisma schema to the configured database and exits non-zero when Prisma-supported schema drift exists.

For an isolated development database where Prisma should manage development migration state:

```bash
npm run db:migrate
```

After applying the migration, verify migration status and drift before marking the live-database checklist items complete. Never point development migration commands at production.

## Database integration tests

Database isolation tests must use a dedicated disposable PostgreSQL database through `TEST_DATABASE_URL`. The runner requires an explicit safety acknowledgement, refuses to reuse the normal `DATABASE_URL`, validates the Prisma schema, applies checked-in migrations, verifies migration status and Prisma-supported schema drift, then runs the real tenant repositories against two separate tenants.

```bash
# example only; use your own disposable local test database
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sf_test?schema=public"
export SF_DATABASE_TEST_CONFIRM="sf-disposable-test-database"
npm run test:database
```

The acknowledgement is intentionally verbose so an accidental environment variable or copied production connection string is less likely to start database integration work. `TEST_DATABASE_URL` must use PostgreSQL, name a database, and differ from `DATABASE_URL`. Do not point it at production or any shared database containing valuable data.

The tenant isolation integration test creates Tenant A and Tenant B with separate users and memberships, verifies Tenant A cannot retrieve Tenant B organization or membership data, and verifies suspended users/memberships immediately lose tenant access. It removes the records it creates when the test finishes.

## Validation

Before considering a coherent slice complete, run the relevant available checks:

```bash
npm run typecheck
npm run lint
npm run test
npm run prisma:validate
npm run build
```

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
