# Hospitality booking read consistency

Hospitality booking management reads are tenant-scoped, authorization-checked, bounded, and snapshot-consistent at the server boundary. One rendered/API response must not combine a booking row from one database observation with related guests, pagination totals, payment rows, or audit rows from a later observation.

## Read snapshot boundary

The following read flows use PostgreSQL `RepeatableRead` after identifier validation and the existing permission check:

- `getHospitalityBooking` reads the tenant-owned booking and its ordered guest snapshots in one transaction;
- `listHospitalityBookings` reads the tenant booking count, the clamped booking page, and ordered guests for only that page in one transaction;
- `listHospitalityBookingAuditEvents` verifies the tenant-owned booking and reads the scoped audit count/page in one transaction; and
- `listBookingPaymentTransactions` reads the tenant-owned booking payment summary and the scoped payment transaction count/page in one transaction.

This prevents a single response from reporting pagination metadata for one database state while returning rows from another, and prevents booking detail from pairing a newer booking with an older traveler snapshot or vice versa.

## Tenant and authorization invariants

Snapshot consistency does not replace access control. Existing authorization remains the outer server boundary:

- booking detail, booking collections, and booking audit history require `booking:read`;
- payment transaction history requires `payment:read`;
- booking lookups repeat both booking ID and organization ID at the database boundary; and
- payment/audit/guest collections repeat the active organization plus their booking/resource scope.

Cross-tenant identifiers remain unavailable even when the caller has a valid session in another organization.

## Pagination and completeness

Booking and payment list page sizes continue to default to 25 and are capped at 100. Booking audit history defaults to 20 and is capped at 50. Requested pages are normalized to positive integers and clamped after the authoritative scoped count. Ordering remains deterministic so page navigation is stable for a single snapshot.

These pages are presentation/read-model boundaries only. Bounded pagination is not complete commercial evidence. Refunds, payment settlement, amendment readiness, pricing, availability, and other business decisions that require full history continue to use their dedicated bounded-completeness contracts and fail closed when completeness cannot be proven.

## Concurrency semantics

`RepeatableRead` is intentionally read-only consistency, not a booking mutation lock. It does not authorize writes, reserve inventory, or prove payment. Commercial writers continue to use their existing serializable/advisory-lock/idempotency boundaries.
