# Public booking abuse control

SF public booking writes use database-backed resource controls so limits remain consistent across application instances. These controls protect inventory from anonymous hold exhaustion without trusting browser-selected tenant identifiers or process-local counters.

## Hold creation guard

`src/server/bookings/public-booking-abuse-control.ts` serializes new public hold attempts per organization with a PostgreSQL transaction advisory lock keyed as `public-booking-ingress:<organizationId>`.

Within that lock, SF checks the tenant-derived internal idempotency key first. Existing requests are allowed through to the canonical hold core so exact retries remain idempotent and changed retries still receive the normal conflict response even when the organization is at its anonymous-write ceiling.

For genuinely new anonymous requests SF currently enforces:

- at most 24 unexpired public booking principals per organization
- at most 4 rooms in one public hold request

A released hold deliberately remains part of the organization ceiling until its principal expires. This conservative policy prevents rapid create/release churn from bypassing the resource guard. When the ceiling is reached the public route returns HTTP `429` with `Retry-After` derived from the earliest active principal expiry.

These limits are application safety defaults, not commercial inventory limits. Inventory capacity, restrictions, active holds, booking allocations, and tenant ownership are still enforced by the canonical transactional availability core.

## HTTP ingress

Anonymous hold creation is exposed only through the organization slug route:

`POST /api/public-bookings/{organization-slug}/hospitality/holds`

The request must come from the same origin as the public booking site and include the browser-generated public request key plus the selected availability request. SF resolves the organization from the slug server-side, derives the internal idempotency key server-side, and never accepts an `organizationId` from the browser.

Successful responses contain only customer-safe hold details and the opaque tenant-bound hold capability. Internal organization, hold, and principal identifiers are not returned separately. Responses are marked `no-store`.

The database-backed ceiling is intentionally independent of client IP addresses because proxy/CDN address trust is deployment-specific. Edge or CDN rate limits can be added later as an additional layer, but they must not replace the database-backed tenant guard, canonical idempotency, or inventory locking.

## Current journey boundary

This route makes hold creation safe to expose, but it does not by itself complete the public booking journey. The public discovery page must not present a final booking action until customer/guest collection, capability-bound booking confirmation, final price revalidation, and payment/recovery are connected end to end. A hold-only button that cannot complete a reservation would be a dead primary action.
