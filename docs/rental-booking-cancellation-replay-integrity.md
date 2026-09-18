# Rental booking cancellation replay integrity

SF treats rental cancellation as a terminal inventory-release mutation with durable audit evidence. Once a booking is cancelled, a later retry is idempotent only when it proves that it is replaying the same retained cancellation decision.

## Replay authority

`cancelRentalBooking` keeps the existing tenant-owned booking lock and current effective unit lock. A cancelled booking is not returned as an idempotent success from lifecycle state alone.

The service reads cancellation audit evidence using the authenticated `organizationId`, booking ID, action `booking.rental.cancelled`, and resource type `rental-booking`. It reads at most two rows and requires exactly one matching event.

The retained `afterData` must agree with the terminal booking and allocation:

- status is `CANCELLED`;
- cancellation timestamp exactly matches `RentalBooking.cancelledAt`;
- allocation ID exactly matches the retained booking allocation;
- `inventoryProtectionReleased` is exactly `true`;
- cancellation reason is already in the canonical normalized form.

Malformed, missing, duplicate, or state-divergent evidence fails closed as an integrity error.

## Reason-bound idempotency

The caller still supplies a required cancellation reason on every invocation. The reason is normalized before the transaction.

For an already-cancelled booking, idempotent success requires the normalized request reason to exactly match the reason retained in the original cancellation audit event. A different reason is not treated as a successful replay because that would let a later request silently rewrite the semantic meaning of the original commercial decision.

The replay check does not create another audit row and does not change the booking, allocation, payment evidence, or inventory state.

## Database uniqueness

Migration `20260918044500_rental_booking_cancellation_audit_uniqueness` adds a partial unique index over tenant, booking resource, action, and resource type for rental cancellation audit events.

The migration explicitly refuses to create the index when duplicate cancellation audit evidence already exists. This keeps historical conflicts visible instead of silently deleting or choosing one record.

The database index enforces at most one cancellation audit event. The application transaction enforces that a terminal cancelled booking has exactly one matching retained event before reporting replay success.

## Validation

`src/server/bookings/rental-booking-cancellation-domain.test.ts` covers cancellation-reason normalization plus exact replay evidence classification, including reason mismatch and malformed or divergent retained evidence.

`scripts/rental-booking-cancellation-replay-source-contract.test.mjs` protects the tenant-scoped audit lookup, bounded duplicate detection, evidence classification, and the rule that idempotent success happens only after retained evidence is verified.

The migration is intentionally database-only because Prisma does not model this partial conditional uniqueness contract in the schema. Live migration execution still requires the repository's explicitly disposable PostgreSQL validation target.

This hardening does not introduce cancellation fees, automatic refunds, provider calls, customer notifications, or other unsupported commercial behavior.
