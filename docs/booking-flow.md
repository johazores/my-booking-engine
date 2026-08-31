# Booking Flow

## Status

SF now has a normalized internal booking domain plus persisted hospitality booking/allocation storage. A valid tenant-owned availability hold can be converted into a confirmed booking and permanent occupied-night allocation inside one serializable transaction using the same room-type allocation lock as hold creation. The conversion persists an immutable exact-money price snapshot, consumes the hold, records a safe audit event, and supports strict organization-scoped idempotent retries.

This is still an internal server boundary, not the complete public booking journey. The final orchestration must revalidate the latest complete server price inside the confirmation transaction before calling the persistence boundary. Booking routes/UI, cancellation/release behavior, payment/provider confirmation, and public checkout remain incomplete and must not be represented as finished.

## Target lifecycle

```text
search
  ↓
availability
  ↓
offer / selection
  ↓
pricing validation
  ↓
customer / traveler details
  ↓
booking creation
  ↓
payment
  ↓
provider confirmation
  ↓
confirmation
  ↓
post-booking management
```

The complete end-to-end workflow remains planned.

## Confirmation command

`src/server/bookings/booking-domain.ts` defines the provider-independent confirmation input. A command references an existing availability hold and customer, requires an organization-scoped idempotency key, carries the expected SHA-256 complete-pricing fingerprint, and includes normalized add-on selections.

Hold, customer, and selected add-on identifiers are validated as UUIDs at the domain boundary. Add-on selections are normalized into deterministic identifier order and are part of idempotency comparison, so a retry cannot silently change extras while reusing a booking key.

## Persisted booking and allocation

`HospitalityBooking` stores tenant/property/room-type/rate-plan/customer/hold ownership, booking and payment states, stay dates, quantity, organization-scoped idempotency identity, selected add-ons, exact immutable price totals, pricing fingerprint, and lifecycle timestamps.

`HospitalityBookingAllocation` stores the permanent occupied-night room-type quantity separately from the booking record. Availability reads and new hold creation subtract non-cancelled booking allocations from physical capacity in addition to active unexpired holds. This prevents a consumed hold from accidentally returning inventory to sale.

Booking and allocation relations use tenant-safe composite foreign keys. One hold can back at most one booking per organization and one booking can own at most one current hospitality allocation in this first normalized hospitality slice.

## Hold conversion semantics

`confirmHospitalityBookingFromHold` requires `booking:manage`, validates organization/actor identifiers, normalizes the command and immutable price snapshot, and requires the snapshot fingerprint to match the command fingerprint before persistence.

Inside a serializable transaction it:

1. serializes the organization/idempotency-key boundary;
2. returns the existing booking only for an exact retry payload;
3. loads the tenant-owned hold and takes the shared room-type availability allocation lock;
4. re-reads the hold and requires it to remain `ACTIVE` and unexpired;
5. requires an active customer in the same organization;
6. requires the held room-type/rate-plan assignment to remain active;
7. creates the confirmed booking with payment state `UNPAID` and immutable price snapshot;
8. creates the permanent occupied-night allocation;
9. transitions the hold to `CONSUMED` with an end timestamp; and
10. writes one safe `booking.confirmed` audit event.

There is no transient capacity gap between hold consumption and permanent allocation because those writes are committed together under the same allocation lock.

## Authorization and tenancy

Booking permissions are explicit:

- organization/platform administrators and managers: `booking:read`, `booking:manage`
- staff: `booking:read`
- customer-role memberships: no internal booking permission

Booking get/list operations always include `organizationId` server-side. Customer, hold, room type, and rate plan relations are tenant constrained independently by database composite foreign keys.

## Immutable pricing snapshot

The snapshot contains:

- currency
- accommodation subtotal minor units
- tax total minor units
- fee total minor units
- add-on total minor units
- total minor units
- complete pricing fingerprint

Every amount is a non-negative integer minor-unit string at the domain boundary, and total must exactly equal accommodation + tax + fee + add-ons. PostgreSQL independently checks non-negative persisted values and the same total equation.

The persistence service deliberately does **not** calculate or trust a browser price. It accepts only a server-side snapshot object. The remaining atomic-confirmation task is to refactor complete pricing evaluation so the latest base rates, taxes/fees, and add-ons are re-read and fingerprint-checked through the same database transaction immediately before booking persistence. Until that is done, the Phase 9 atomic confirmation checklist item remains open.

## Idempotency

Booking idempotency is organization scoped in PostgreSQL. The service also takes a transaction-scoped advisory lock for the organization/idempotency-key pair before checking an existing booking.

An exact retry must match hold ID, customer ID, expected pricing fingerprint, and normalized selected add-ons. Reusing the same key for a different payload is rejected. A hold also cannot be consumed into a second booking under another idempotency key.

## Booking and payment state

Booking state and payment state are deliberately separate domain and database concepts.

Booking states:

- `PENDING_CONFIRMATION`
- `CONFIRMED`
- `CANCELLED`

Payment states:

- `UNPAID`
- `AUTHORIZED`
- `PAID`
- `PARTIALLY_REFUNDED`
- `REFUNDED`
- `FAILED`

The domain currently allows `PENDING_CONFIRMATION → CONFIRMED`, `PENDING_CONFIRMATION → CANCELLED`, and `CONFIRMED → CANCELLED`. Reopening a cancelled booking or moving a confirmed booking back to pending is rejected by the domain contract. Payment state is never inferred from booking state.

Cancellation is not implemented yet. When it is added, it must atomically release the allocation only when the booking lifecycle allows it and must preserve booking/price/audit history.

## History and audit

Tenant-scoped get/list services expose persisted booking history with bounded pagination. Booking confirmation writes an audit event containing safe booking scope, status, quantity, exact total, and pricing fingerprint; it does not log credentials, payment-card data, secrets, or session tokens.

## Validation coverage

Dependency-free booking-domain tests cover UUID/idempotency/fingerprint validation, deterministic add-on selections, exact immutable money snapshots, snapshot/command fingerprint consistency, booking state transitions, and idempotent payload comparison.

The disposable PostgreSQL suite includes booking persistence coverage for permission denial, cross-tenant denial, hold consumption, permanent allocation, exact retry behavior, conflicting retry behavior, availability after conversion, tenant-scoped read/list, immutable totals, and audit creation. It is wired into `npm run test:database` but must only be claimed as executed when an explicitly disposable PostgreSQL target is available.

## Remaining booking dependencies

The next highest-value booking dependency is **transaction-local complete price revalidation** followed by the real confirmation orchestration/API boundary. That work must ensure the authoritative complete quote and fingerprint are recalculated from current persisted pricing inside the same transaction as hold consumption and permanent allocation.

After that, the booking journey can safely advance into cancellation/allocation release, payment state transitions, public offer/customer/checkout UI, and provider confirmation without weakening the core inventory guarantees.
