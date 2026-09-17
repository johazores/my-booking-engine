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
- tenant-owned customers, immutable booking/customer snapshots, and a narrow irreversible de-identification workflow for archived customer profiles with no supported hospitality or rental booking references;
- hospitality properties, room types, rooms, amenities, images, rate plans, restrictions, availability windows, holds, allocation locking, pricing, taxes/fees, and add-ons;
- tenant-owned tour/package inventory with departure schedules, explicit configured capacity, add-ons, audited lifecycle controls, and bounded management collections;
- tenant-owned appointment inventory with services, staff, explicit staff/service eligibility, recurring weekly schedules, audited lifecycle controls, and bounded management collections;
- tenant-owned rental inventory with unit types, operating locations, physical units, unavailable date blocks, daily rate configuration and date-range rate overrides, temporary holds, conversion-authority review, durable confirmed rental bookings/physical-unit allocations, tenant-scoped staff booking list/detail, same-unit price-neutral date rescheduling with append-only evidence, same-type/same-location physical-unit substitution with append-only evidence, terminal inventory-release cancellation, staff-only full-value manual/offline settlement and remaining refunds, append-only pickup/return custody evidence, overdue-custody inventory protection and staff overdue queue, explicit whole-day early-return inventory release, separate operational availability, durable maintenance work orders, append-only return-condition inspection with non-clear unit quarantine, explicit non-clear damage-case assessment/waiver/resolution evidence, one append-only post-closure customer-damage-liability decision, audited lifecycle controls, and booked-inventory protection;
- exact-money hospitality quoting, price fingerprints, atomic hold-to-booking confirmation, idempotency, permanent booking allocations, and booking audit history;
- authenticated hospitality booking detail, cancellation, same-price date rescheduling, traveler snapshot editing, provider-aware refunds, receipts, audit history, and room/rate/quantity/add-on commercial modification;
- an explicit versioned hospitality commercial-amendment lifecycle for non-zero room/rate/quantity/add-on price deltas, including target inventory protection, manual/Stripe settlement, reconciliation, final serializable apply, expiry, and compensation recovery;
- a normalized payment contract plus manual/offline payments and a real Stripe adapter for authorization/capture, hosted Checkout, verified webhooks, reconciliation, refunds, public payment recovery, and commercial-amendment settlement;
- Australian hospitality legal-document infrastructure with immutable issuer/recipient/pricing evidence, serializable tax-invoice numbering and issuance, direction-aware commercial adjustment-note chains, supported cancellation adjustments, deterministic PDFs for the current lossless-text contract, tenant registers/accounting exports, retention boundaries, and reconciliation;
- encrypted tenant integration credentials, provider capabilities, lifecycle management, connection health, rotation, disable/enable/archive/reconnect behavior, and secret-safe auditing;
- a server-only Travelport TripServices Stays supplier adapter for bounded SearchComplete discovery, exact pricing, Rules, selected-offer Availability authority, durable reservation attempts, known-locator recovery, reviewed Create infrastructure, and Booking.com Sync recovery; its `reservation` capability remains intentionally disabled pending the documented activation gates; and
- a real tenant-branded public hospitality journey from live discovery through hold, current-price review, customer/guest capture, booking confirmation, Stripe Checkout, signed payment completion, abandonment handling, and recovery.

Provider-specific behavior remains behind adapters. Browser redirects are never accepted as proof of payment, public callers never receive staff authority, and tenant scope is resolved and revalidated server-side.

## Intentionally incomplete areas

The repository does not pretend unfinished product areas are complete. Notable remaining work includes:

- price-changing hospitality date reschedules beyond the current same-price reschedule contract, if that product capability is prioritized;
- remaining Australian legal-document boundaries such as mixed-taxability or partial/non-standard-GST adjustments, generic correction/void/reissue, durable re-authenticated customer history and email/resend delivery, universal Unicode-safe PDF rendering, broader booking-linked customer-data disposal, production database/toolchain validation, and jurisdiction/legal review;
- activation of the implemented Travelport Stays reservation lifecycle only after a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative locator-less/retry/recovery semantics are proven, plus later provider-specific supplier integrations when required;
- additional payment/email/SMS providers only when there is a real product requirement;
- customer-facing availability, pricing, booking, payment, and provider/calendar workflows for tour and appointment inventory;
- customer-facing rental booking/payment, unit-type/location-changing rental amendments, price-changing rental amendments/rescheduling, deposits and online rental checkout/card authorization, split tenders, cancellation fees/automated refunds, customer-facing pickup/drop-off/delivery semantics, rental extensions/late-return fees, customer damage-payment collection and repair-cost/security-bond settlement, richer maintenance/vendor/cost workflows, notifications, provider-backed rental payments, and external synchronization on top of the implemented staff hold-to-booking/read/reschedule/same-type-same-location-unit-substitution/cancellation/manual-settlement/pickup-return/early-return-release/operational-availability/maintenance/return-inspection/damage-case/damage-liability infrastructure; and
- marketplace capabilities and other advanced business modules only when concrete product requirements justify them.

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
- `docs/tour-inventory.md`
- `docs/appointment-inventory.md`
- `docs/rental-inventory.md`
- `docs/rental-booking-foundation.md`
- `docs/rental-booking-reschedule-lifecycle.md`
- `docs/rental-booking-unit-substitution-authority.md`
- `docs/rental-booking-cancellation.md`
- `docs/rental-payment-foundation.md`
- `docs/rental-booking-fulfillment-foundation.md`
- `docs/rental-early-return-inventory-release.md`
- `docs/rental-overdue-custody-availability.md`
- `docs/rental-booking-read-consistency.md`
- `docs/rental-unit-operational-availability.md`
- `docs/rental-maintenance-work-orders.md`
- `docs/rental-return-inspection.md`
- `docs/rental-damage-case.md`
- `docs/rental-damage-liability.md`
- `docs/booking-flow.md`
- `docs/public-booking-payments.md`
- `docs/payments.md`
- `docs/booking-management.md`
- `docs/booking-commercial-adjustments.md`
- `docs/commercial-amendment-orchestration.md`
- `docs/invoice-foundation.md`
- `docs/customer-data-lifecycle.md`
- `docs/integration-architecture.md`
- `docs/supplier-reservation-provider-evidence.md`
- `docs/development-guide.md`

Documentation must describe what the repository actually implements and must not present planned integrations or workflows as real.
