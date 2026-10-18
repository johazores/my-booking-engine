# Public booking abuse control

SF public booking writes use database-backed resource controls so limits remain consistent across application instances. These controls protect inventory from anonymous hold exhaustion without trusting browser-selected tenant identifiers or process-local counters.

## Hold creation guard

`src/server/bookings/public-booking-abuse-control.ts` serializes new public hold attempts per organization with a PostgreSQL transaction advisory lock keyed as `public-booking-ingress:<organizationId>`.

Within that lock, SF checks the tenant-derived internal idempotency key before applying either the per-request room limit or the tenant-wide active-principal ceiling. Existing requests reach the canonical hold core so exact retries remain idempotent and changed retries receive HTTP `409`, including when the changed quantity exceeds four rooms or the tenant is at its anonymous-write ceiling. Only genuinely new requests receive the four-room HTTP `400` limit.

For genuinely new anonymous requests SF currently enforces:

- at most 24 unexpired public booking principals per organization that still own an unconfirmed/released hold or a non-cancelled booking with unresolved (`UNPAID`, `AUTHORIZED`, or `FAILED`) payment
- at most 4 rooms in one public hold request

An over-limit room quantity is a typed client validation failure (HTTP `400`), not an unexpected HTTP `500`. The separate tenant-wide anonymous-principal ceiling continues to return HTTP `429` with `Retry-After`.

A released hold deliberately remains part of the organization ceiling until its principal expires. Paid, refunded, and cancelled booking principals no longer consume anonymous hold quota for their 24-hour customer recovery-credential lifetime. The booking and payment state is read from persisted tenant-owned booking relations, not client input. An unresolved booking continues to count until its recovery principal expires. This conservative policy prevents rapid create/release churn from bypassing the resource guard. When the ceiling is reached the public route returns HTTP `429` with `Retry-After` derived from the earliest active principal expiry.

These limits are application safety defaults, not commercial inventory limits. Inventory capacity, restrictions, active holds, booking allocations, and tenant ownership are still enforced by the canonical transactional availability core.

## HTTP ingress

Anonymous hold creation is exposed only through the organization slug route:

`POST /api/public-bookings/{organization-slug}/hospitality/holds`

The request must come from the same origin as the public booking site and include the browser-generated public request key plus the selected availability request. SF resolves the organization from the slug server-side, derives the internal idempotency key server-side, and never accepts an `organizationId` from the browser.

Successful responses contain only customer-safe hold details and the opaque tenant-bound hold capability. Internal organization, hold, and principal identifiers are not returned separately. Responses are marked `no-store`.

The database-backed ceiling is intentionally independent of client IP addresses because proxy/CDN address trust is deployment-specific. Edge or CDN rate limits can be added later as an additional layer, but they must not replace the database-backed tenant guard, canonical idempotency, or inventory locking.

## Current journey boundary

The public hospitality journey is now connected end to end: live discovery, capability-owned holds, authoritative quotes, customer/guest collection, atomic confirmation, Stripe-hosted Checkout, and signed/provider-truth payment recovery. The tenant-scoped anonymous-hold ceiling remains an additional abuse control, not a replacement for persisted ownership, capability verification, price revalidation, capacity locking, or payment reconciliation.
