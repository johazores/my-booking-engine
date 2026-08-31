# Booking Flow

## Status

SF now has a normalized internal booking-domain foundation for confirmation commands, immutable exact-money price snapshots, explicit booking-state transitions, payment-state separation, and idempotency-payload comparison. This is domain groundwork only: booking persistence, permanent inventory allocation, atomic hold consumption, booking routes/UI, and provider/payment confirmation are still incomplete and must not be represented as finished.

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

## Implemented domain boundary

`src/server/bookings/booking-domain.ts` defines the provider-independent booking confirmation input used by the next persistence layer. A confirmation command references an existing availability hold and customer, requires an organization-scoped idempotency key, and carries the expected SHA-256 pricing fingerprint so stale pricing can be rejected before a permanent allocation is committed.

The booking domain also defines an immutable exact-money hospitality price snapshot containing accommodation, tax, fee, add-on, and total minor-unit amounts. Snapshot creation validates that all components are non-negative integer minor units and that the total exactly equals the component sum. Currency and pricing fingerprint are normalized at the boundary.

Booking state and payment state are deliberately separate domain concepts. The current booking transition contract allows `PENDING_CONFIRMATION → CONFIRMED`, `PENDING_CONFIRMATION → CANCELLED`, and `CONFIRMED → CANCELLED`. Reopening a cancelled booking or moving a confirmed booking back to pending is rejected by the domain contract. Payment state is not inferred from booking state.

Idempotent retry comparison is strict: reusing a booking idempotency key is safe only when hold, customer, and expected pricing fingerprint match the original command. The persistence layer still needs to enforce organization-scoped uniqueness transactionally.

## Domain principles

A booking is not a single database insert. The lifecycle can include inventory holds, repricing, external provider operations, payment authorization/capture, provider confirmation, cancellation, refund, rescheduling, and audit history.

Booking and payment status must remain distinct. A provider may confirm inventory before payment settles, or payment may succeed before an external supplier operation fails.

## Expected operations

- search
- availability
- pricing
- create booking
- retrieve booking
- modify/reschedule
- cancel
- refund
- collect payment
- confirm
- booking history
- audit history

## Reliability requirements

Important writes must be idempotent where retries can happen. The system must safely handle provider or network failures after an external operation may already have succeeded.

The next implementation boundary is persisted booking/allocation storage that, inside one serializable transaction and the same room-type allocation lock used by holds, must validate an active unexpired tenant-owned hold, revalidate the current complete price, persist the immutable price snapshot, consume the hold, create permanent occupied-night capacity, and return the same booking for an exact idempotent retry. Last-unit concurrency tests must prove two competing confirmations cannot overbook inventory.
