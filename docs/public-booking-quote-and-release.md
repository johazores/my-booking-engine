# Public booking quote and release boundary

## Status

SF now exposes a customer-safe lifecycle around an anonymous hospitality hold without weakening the staff booking authorization model.

`POST /api/public-bookings/[organization-slug]/hospitality/holds` creates the tenant-scoped hold and returns an opaque expiring capability. `DELETE` on the same route releases that hold only after the capability and persisted public ownership are both revalidated. All public write responses are `no-store` and all writes require a matching `Origin`.

`POST /api/public-bookings/[organization-slug]/hospitality/quote` revalidates the active capability-owned hold and recalculates current persisted pricing for that exact held stay. It accepts only optional add-on selections; property, room type, rate plan, dates, quantity, and tenant scope are derived from the persisted hold rather than trusted from the browser.

## Customer-safe quote

The quote boundary uses the same `quoteHospitalityPriceFromReader` calculation used by booking confirmation. The response includes exact-money nightly amounts, taxes, fees, add-ons, totals, the pricing fingerprint, and hold expiry. It deliberately excludes organization IDs, principal IDs, hold IDs, property IDs, room-type IDs, and rate-plan IDs.

An expired capability, ended hold, missing ownership row, principal mismatch, or cross-tenant slug/capability combination fails closed as unavailable. Pricing that can no longer be produced returns a retryable commercial conflict instead of silently falling back to discovery-time prices.

## Release semantics

Public release calls the canonical allocation-locked hold release transaction. That keeps release serialized with competing hold creation and booking confirmation. Releasing an already ended hold remains idempotent according to the existing hold core, and public audit attribution is written only when the state actually changes.

## HTTP policy

`src/server/bookings/public-booking-http-policy.ts` centralizes the same-origin policy used by public booking mutations. Missing, malformed, and cross-origin `Origin` values are denied. This avoids slightly different security checks appearing as more anonymous booking routes are added.

## Remaining confirmation dependency

This slice does not expose final booking confirmation or payment collection. The next public-booking dependency remains a customer-safe confirmation transaction that:

- attaches durable customer/guest identity without creating a synthetic staff actor;
- verifies the opaque capability plus persisted public ownership again;
- treats the returned pricing fingerprint as review state and recalculates pricing inside the confirmation transaction;
- preserves exact idempotency across customer retries;
- creates booking/allocation/guest snapshots, consumes the hold, and writes truthful public audit attribution atomically; and
- starts real payment collection/recovery only through the configured payment provider adapter.

The public UI must not present a final `Book now` action until that boundary is complete. A hold or quote alone is not a completed commercial booking.

## Validation

The customer-safe quote projection and shared same-origin policy have dependency-free Node tests. Full typecheck, lint, Prisma validation, PostgreSQL integration coverage, and production build still require the repository Node 24 environment and disposable database target documented in the development guide. GitHub Actions are not part of this validation process.
