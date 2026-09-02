# Public booking confirmation boundary

## Status

SF now has a server-side customer-safe confirmation boundary for capability-owned hospitality holds. It is intentionally not exposed as a final anonymous HTTP action yet: confirming an unpaid booking permanently allocates inventory, so the public UI must wait until real payment collection and recovery are connected through the configured payment provider.

## Shared canonical transaction

`src/server/bookings/hospitality-booking-confirmation-core.ts` now owns the provider-independent serializable confirmation transaction used by both staff and public callers. The core:

- locks the tenant-scoped booking idempotency key;
- reuses the same organization/property/room-type allocation advisory lock as availability holds;
- requires the hold to remain active and unexpired;
- requires an active tenant-owned customer;
- enforces room occupancy against immutable guest snapshots;
- recalculates persisted pricing inside the transaction and requires the reviewed pricing fingerprint to match;
- creates the confirmed/unpaid booking, guest snapshots, and booking allocation;
- consumes the hold atomically; and
- reports whether the booking was newly created so each caller can write truthful actor-specific audit data without duplicate retry events.

The existing staff service still requires `booking:manage` before entering this core and still writes normal `AuditEvent` rows with the authenticated user. Public confirmation does not call that permission wrapper and never creates a synthetic staff user.

## Public customer and ownership

`confirmPublicHospitalityBookingFromHold` resolves the active organization from the public slug and verifies both the encrypted hold capability and persisted `PublicBookingHoldOwnership` before any booking is created.

Public confirmation requires a canonical email so the booking has a durable recovery contact. An existing active customer with the same canonical email inside the same organization is reused; an archived customer is not silently reactivated. A new customer is created inside the same serializable transaction when necessary. Guest names and emails continue to be copied into immutable booking guest snapshots.

`PublicBookingBookingOwnership` binds the resulting booking to the same public principal and organization. PostgreSQL composite foreign keys prevent a booking or principal from being attached across tenants. The ownership row also stores a SHA-256 request fingerprint covering normalized customer contact, guests, add-ons, and reviewed pricing, so a reused public confirmation request key cannot silently accept changed customer data that the internal booking idempotency shape does not contain.

## Idempotency and capability separation

Browser request keys remain UUID v4 values. SF derives hold and confirmation idempotency keys with separate HMAC namespaces, so the same external request key cannot collide across lifecycle operations.

A successful confirmation issues a new AES-256-GCM `booking:manage` capability with a 24-hour recovery window and extends the durable public principal to the same expiry. The booking capability is scope-separated from the hold capability and does not expose organization, principal, or booking IDs in plaintext. Future payment/recovery endpoints must verify this capability **and** the persisted booking ownership row before reading or mutating the booking.

The hold capability remains short-lived and is not upgraded in place.

## Audit attribution

Public confirmation writes only `PublicBookingAuditEvent` rows. `public-booking.confirmed` records status, payment status, quantity, guest count, currency, total, and pricing fingerprint without copying customer email or phone into audit JSON. When the public flow creates a new customer it also writes `public-booking.customer.created` with lifecycle status only.

Staff `booking.confirmed` audit behavior remains unchanged through the shared core wrapper.

## HTTP/UI boundary

No anonymous confirmation route or final `Book now` action is added by this slice. The next dependency is real payment collection and recovery using the configured payment-provider adapter, including safe failure/abandonment handling so public traffic cannot convert holds into indefinitely unpaid inventory reservations.

Only after that payment lifecycle is coherent should the public page collect customer/guest details and expose final confirmation.

## Validation

Dependency-free public capability/request tests cover:

- hold and booking capability tenant/principal binding;
- scope separation between hold and booking credentials;
- ciphertext/tag/version tampering rejection;
- weak-secret rejection;
- hold-vs-confirmation idempotency namespace separation; and
- deterministic request fingerprints that change with normalized payload changes.

`public-hospitality-confirmation.integration.ts` is registered in the disposable PostgreSQL harness for tenant-bound ownership, customer creation/reuse, exact retries, changed-request rejection, public-only audit attribution, customer-safe serialization, and cross-tenant denial.

The available automation shell can run only the dependency-free Node tests. Full Prisma validation, migration execution, PostgreSQL integration tests, repository typecheck/lint, and production build still require the repository's Node 24 environment plus a confirmed disposable PostgreSQL target. GitHub Actions are not used.
