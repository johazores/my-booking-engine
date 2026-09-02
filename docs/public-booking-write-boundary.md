# Public booking write boundary

## Status

SF exposes real anonymous hospitality hold, quote, release, confirmation, and Stripe Checkout HTTP boundaries as one connected customer journey. Public callers never receive staff authority, never choose an organization ID as authority, and never create synthetic staff users.

Tenant scope comes from the active organization slug. Commercial mutations additionally require opaque capability credentials plus durable `PublicBookingPrincipal` ownership, and public actions use `PublicBookingAuditEvent` instead of weakening the existing staff audit model. Inventory writes reuse the same canonical PostgreSQL locking and serializable transaction rules as staff workflows.

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

`POST /api/public-bookings/[organization-slug]/hospitality/quote` verifies the capability and persisted ownership, then recalculates persisted pricing for the exact hold. Property, room type, rate plan, dates, quantity, tenant, principal, and hold identifiers are not accepted from the browser as authority for quote scope.

If quote retrieval fails after hold creation, the public client explicitly requests release. It only clears local hold state after release succeeds; an uncertain cleanup keeps the capability available and exposes a retry action instead of claiming inventory was released.

## Confirmation boundary

`POST /api/public-bookings/[organization-slug]/hospitality/confirmation` is the customer-safe public confirmation ingress. It verifies the encrypted hold capability and durable ownership again, requires normalized customer/recovery contact plus immutable guest snapshots, and requires the reviewed pricing fingerprint.

`confirmPublicHospitalityBookingFromHold` creates or reuses an active tenant-local customer, calls the shared serializable booking confirmation core, consumes the hold, persists the booking/guest/allocation snapshot, creates `PublicBookingBookingOwnership`, and writes truthful public-only audit attribution.

Public confirmation initially creates `PENDING_CONFIRMATION / UNPAID`. A separate encrypted `booking:manage` capability is issued for payment/recovery. Hold and booking credentials use different scopes and versions.

Public confirmation idempotency uses its own HMAC namespace. The ownership row stores a normalized request fingerprint so changing customer/contact, guest, add-on, or reviewed-pricing input while reusing a request key fails closed.

## Payment-start and recovery boundary

A public booking has a bounded payment-start lifecycle. The pending allocation protects capacity only while the initial payment-start window, a bounded unresolved-payment recovery window, an open durable Checkout Session, or successful payment evidence exists.

`POST /api/public-bookings/[organization-slug]/hospitality/payments/stripe-checkout` accepts the booking capability plus a separate UUID-v4 public request key. It revalidates tenant, principal, booking ownership, booking/payment state, and exact persisted money before the Stripe adapter is called. The server derives return URLs; callers cannot inject arbitrary redirect targets.

Before the provider call SF persists a tenant-bound pending payment claim under the established booking/payment lock namespace. A valid Stripe Checkout Session is durably bound before its URL is returned and promotes the booking to `CONFIRMED`. Exact retries reuse the same tenant-derived Stripe idempotency key.

The public payment-status endpoint accepts the booking capability in a same-origin POST body, not a URL. Browser redirects are never proof of payment. Signed Stripe PaymentIntent and Checkout Session webhooks plus provider-truth recovery determine paid, failed, processing, expired, and abandonment state.

## HTTP and credential handling

Public write routes use the shared same-origin policy and `Cache-Control: no-store`.

Capabilities must never appear in URLs, logs, analytics, audit payloads, or rendered server HTML. The public browser keeps the short-lived booking capability only in same-tab `sessionStorage` for Checkout return/recovery and clears terminal recovery state. HTTPS remains mandatory in production.

## Validation

Public capability/request tests cover capability tampering, tenant/principal binding, hold-vs-booking scope separation, idempotency namespace separation, weak-secret rejection, deterministic request fingerprints, payment-start windows, and payment recovery decisions.

Disposable PostgreSQL coverage includes public hold lifecycle, confirmation ownership/retry/cross-tenant behavior, capacity protection/expiry, payment persistence, Checkout lifecycle, and signed provider reconciliation. Full database validation is only run against an explicitly confirmed disposable target; GitHub Actions are not used.