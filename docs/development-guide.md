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

Create a local PostgreSQL database and update `DATABASE_URL` before running migrations.

## Validation

Before considering a coherent slice complete, run the relevant available checks:

```bash
npm run typecheck
npm run lint
npm run prisma:validate
npm run build
```

When database behavior is added, include appropriate schema/migration validation and tests for important domain rules.

## Code organization

- `app/` — Next.js routes and layouts
- `src/components/` — reusable product components
- `src/server/` — server-only application/data-access code
- `prisma/` — database schema/migrations
- `docs/` — architecture and product engineering documentation

Keep business rules out of UI components. Keep route handlers thin. Avoid generic utility dumping grounds and unnecessary deep nesting.

## Naming

Use kebab-case for project-created files and folders. Framework-required names such as `page.tsx`, `layout.tsx`, and `route.ts` are allowed.

## Repository automation

Do not add `.github/workflows` or GitHub Actions. Validation is intentionally local unless this policy is explicitly changed later.
