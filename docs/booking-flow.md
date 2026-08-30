# Booking Flow

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

This workflow is planned, not yet implemented.

## Domain principles

A booking is not a single database insert. The lifecycle can include inventory holds, repricing, external provider operations, payment authorization/capture, provider confirmation, cancellation, refund, rescheduling, and audit history.

Booking and payment status must remain distinct where appropriate. A provider may confirm inventory before payment settles, or payment may succeed before an external supplier operation fails.

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
