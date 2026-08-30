# SF

SF is the clean foundation for a commercial multitenant booking infrastructure platform.

The previous prototype has been intentionally removed. Git history is preserved, but the current codebase no longer carries the old Vacation Me UI, MUI/Tailwind prototype components, RapidAPI-specific booking flow, mock response data, or legacy architecture.

## Technology

- Node.js 24 LTS
- Next.js 16.3.3 with the App Router
- React 19.2.8
- TypeScript 6.0.3 in strict mode
- Prisma ORM 7.10 with the PostgreSQL driver adapter
- PostgreSQL
- Native CSS with reusable design tokens

## Current foundation

Implemented now:

- SF product branding and responsive public foundation page
- clean Next.js application structure
- PostgreSQL/Prisma organization, user, and organization-membership foundation
- tenant-safe organization repository queries that always scope access through active membership
- liveness health endpoint
- repository engineering rules and architecture documentation

Not implemented yet:

- authentication
- roles/permissions
- tenant settings and white-label branding
- customers
- inventory/availability/pricing
- bookings/payments/refunds
- provider integrations/GDS

Those are intentionally not represented as completed product features.

## Setup

```bash
cp .env.example .env.local
npm install
npm run prisma:generate
npm run dev
```

Use Node.js `24.20.0` or another supported Node.js 24 LTS release.

## Validation

```bash
npm run typecheck
npm run lint
npm run prisma:validate
npm run build
```

## Documentation

- `docs/architecture.md`
- `docs/database-design.md`
- `docs/booking-flow.md`
- `docs/integration-architecture.md`
- `docs/gds-integration.md`
- `docs/tenant-system.md`
- `docs/security.md`
- `docs/development-guide.md`
- `docs/product-roadmap.md`

Read `AGENTS.md` before making repository changes.
