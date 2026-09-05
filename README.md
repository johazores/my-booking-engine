# SF

SF is production commercial booking infrastructure for multitenant, white-label booking businesses. The codebase is a modular Next.js application with a normalized internal booking domain, PostgreSQL persistence, tenant-safe server boundaries, and provider adapters for external systems.

The previous Vacation Me prototype, mock flight data, MUI/Tailwind UI, RapidAPI-specific booking flow, legacy SCSS, and old provider coupling have been removed. Git history is preserved.

## Technology

- Node.js 24 LTS
- Next.js 16.3.3 with the App Router
- React 19.2.8
- TypeScript 6.0.3 in strict mode
- Prisma ORM 7.10 with `@prisma/adapter-pg`
- PostgreSQL
- Native CSS and design tokens

## Implemented platform

The current repository includes real persisted production boundaries for:

- first-party email/password authentication, opaque sessions, organization membership, roles, permissions, and audited tenant administration;
- a persistent responsive SF application shell with tenant switching, account controls, and real tenant data;
- tenant branding and white-label settings applied to both the authenticated workspace and public hospitality booking route;
- tenant-owned customers, immutable booking-specific guest snapshots, and a narrow irreversible de-identification workflow for archived customer profiles with no hospitality booking references;
- hospitality properties, room types, rooms, amenities, images, rate plans, restrictions, availability windows, holds, allocation locking, pricing, taxes/fees, and add-ons;
- exact-money hospitality quoting, price fingerprints, atomic hold-to-booking confirmation, idempotency, permanent booking allocations, and booking audit history;
- authenticated booking detail, cancellation, same-price date rescheduling, traveler snapshot editing, provider-aware refunds, receipts, audit history, and room/rate/quantity/add-on commercial modification;
- an explicit versioned commercial-amendment lifecycle for non-zero room/rate/quantity/add-on price deltas, including target inventory protection, manual/Stripe settlement, reconciliation, final serializable apply, expiry, and compensation recovery;
- a normalized payment contract plus manual/offline payments and a real Stripe adapter for authorization/capture, hosted Checkout, verified webhooks, reconciliation, refunds, public payment recovery, and commercial-amendment settlement;
- Australian hospitality legal-document infrastructure with immutable issuer/recipient/pricing evidence, serializable tax-invoice numbering and issuance, direction-aware commercial adjustment-note chains, supported cancellation adjustments, deterministic PDFs for the current lossless-text contract, tenant registers/accounting exports, retention boundaries, and reconciliation;
- encrypted tenant integration credentials, provider capabilities, lifecycle management, connection health, rotation, disable/enable/archive/reconnect behavior, and secret-safe auditing; and
- a real tenant-branded public hospitality journey from live discovery through hold, current-price review, customer/guest capture, booking confirmation, Stripe Checkout, signed payment completion, abandonment handling, and recovery.

Provider-specific behavior remains behind adapters. Browser redirects are never accepted as proof of payment, public callers never receive staff authority, and tenant scope is resolved and revalidated server-side.

## Intentionally incomplete areas

The repository does not pretend unfinished product areas are complete. Notable remaining work includes:

- price-changing date reschedules beyond the current same-price reschedule contract, if that product capability is prioritized;
- remaining Australian legal-document boundaries such as mixed-taxability or partial/non-standard-GST adjustments, generic correction/void/reissue, durable re-authenticated customer history and email/resend delivery, universal Unicode-safe PDF rendering, broader booking-linked customer-data disposal, production database/toolchain validation, and jurisdiction/legal review;
- the first external supplier/GDS adapter and later provider-specific supplier integrations;
- additional payment/email/SMS providers only when there is a real product requirement; and
- tours, appointments, rentals, marketplace capabilities, and other advanced business modules after the shared booking foundation is proven.

## Setup

```bash
cp .env.example .env.local
npm install
npm run prisma:generate
npm run dev
```

Use Node.js `24.20.0` or another version accepted by the repository's Node 24 engine range.

## Validation

Standard local validation:

```bash
npm run validate
```

Database validation is intentionally separate and must target an explicitly disposable PostgreSQL database:

```bash
npm run test:database
```

The database harness validates Prisma/migrations and runs the checked-in tenant, auth, authorization, organization, branding, customer, inventory, availability, pricing, booking, payment, integration, and public-booking scenarios. GitHub Actions are intentionally not used.

## Documentation

Start with:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/database-design.md`
- `docs/product-roadmap.md`
- `docs/booking-flow.md`
- `docs/public-booking-payments.md`
- `docs/payments.md`
- `docs/booking-management.md`
- `docs/booking-commercial-adjustments.md`
- `docs/commercial-amendment-orchestration.md`
- `docs/invoice-foundation.md`
- `docs/customer-data-lifecycle.md`
- `docs/integration-architecture.md`
- `docs/development-guide.md`

Documentation must describe what the repository actually implements and must not present planned integrations or workflows as real.
