# Public booking write boundary

## Status

SF exposes real anonymous hospitality **hold**, **quote**, and **release** HTTP boundaries while keeping final booking confirmation server-only until payment/recovery is complete.

The public flow never calls a staff permission wrapper or invents a synthetic user. Tenant scope comes from the active organization slug, public actions use durable `PublicBookingPrincipal` ownership plus `PublicBookingAuditEvent`, and inventory writes reuse the same canonical PostgreSQL locking and serializable transaction rules as staff workflows.

## Hold creation

`POST /api/public-bookings/[organization-slug]/hospitality/holds`:

- resolves the active tenant from the slug server-side;
- derives the internal idempotency key from a browser UUID v4 request key, tenant ID, deployment secret, and the hold-specific HMAC namespace;
- applies the PostgreSQL-backed anonymous hold ceiling before new requests;
- calls the canonical hold transaction for assignment, restrictions, capacity, active-hold, and booking-allocation checks;
- creates the public principal, hold ownership, and public audit event atomically for new holds; and
- returns customer-safe hold metadata plus an opaque encrypted hold capability.

Exact retries preserve the original hold/principal. Changed payloads using the same request key conflict. A released hold stays inside the conservative tenant ingress ceiling until its principal expires.

## Quote and release

The same hold route supports capability-bound release through the canonical allocation-locked release transaction. Repeated release is idempotent and audit rows are written only when state changes.

`POST /api/public-bookings/[organization-slug]/hospitality/quote` verifies the capability and persisted ownership, then recalculates persisted pricing for the exact hold. Property, room type, rate plan, dates, quantity, tenant, principal, and hold identifiers are not trusted from the browser or returned as public identifiers.

Public write routes use the shared same-origin policy and `Cache-Control: no-store`.

## Confirmation server boundary

`confirmPublicHospitalityBookingFromHold` is implemented but deliberately has no public route yet. It verifies the encrypted hold capability and durable ownership again, requires a canonical recovery email, creates or reuses an active tenant-local customer, and calls the shared booking confirmation transaction.

On success it atomically persists `PublicBookingBookingOwnership`, truthful public audit attribution, and extends the public principal for a 24-hour recovery window. A separate encrypted `booking:manage` capability is issued for future payment/recovery operations. Hold and booking credentials use different scopes and versions.

Public confirmation idempotency uses its own HMAC namespace. The persisted ownership row also stores a normalized request fingerprint so changing customer/contact information while reusing a request key fails closed even when the internal booking payload would otherwise reference the same customer ID.

## Remaining production boundary

The next dependency is real payment collection and recovery through the configured payment-provider adapter. Until SF can safely handle payment success, failure, retry, and abandonment for a capability-owned booking, the public UI must not expose final confirmation. Confirmed unpaid inventory cannot be allowed to become an anonymous denial-of-inventory path.

Future payment/recovery endpoints must verify both the encrypted booking capability and persisted booking ownership. Capabilities must never appear in URLs, logs, analytics, audit payloads, or rendered server HTML. HTTPS remains mandatory in production.

## Validation

Public capability/request tests cover capability tampering, tenant/principal binding, hold-vs-booking scope separation, idempotency namespace separation, weak-secret rejection, and deterministic request fingerprints. Disposable PostgreSQL coverage includes public hold lifecycle and public confirmation ownership/retry/cross-tenant behavior. Full database validation is only run against an explicitly confirmed disposable target; GitHub Actions are not used.
