# Zero-delta commercial modification write scope

SF applies room-type, rate-plan, quantity, and add-on changes directly only when a fresh server-side quote proves the persisted booking money is unchanged. This document records the production persistence boundary for that zero-delta path. It complements `docs/booking-management.md`, `docs/booking-commercial-adjustments.md`, `docs/availability.md`, and `docs/pricing.md`.

## Authority and serialization

`modifyHospitalityBookingCommercialTerms` validates UUID inputs, requires `booking:manage`, derives organization and actor authority from the authenticated server boundary, and runs the mutation in a serializable transaction. It acquires the shared tenant-and-booking mutation advisory lock and the current/target room-type allocation locks before re-reading mutable booking state.

The direct path remains unavailable when a commercial amendment is active, when an authorization/capture operation is unresolved as `PENDING` or `AMBIGUOUS`, or when the fresh authoritative quote changes any persisted money component. Price-changing work remains owned by the versioned commercial-amendment workflow.

## Booking and allocation coherence

A confirmed booking is not sufficient mutation authority by itself. Its retained `HospitalityBookingAllocation` must still represent the same organization, booking, property, room type, quantity, arrival date, and departure date as the booking snapshot. A mismatch fails closed before inventory or pricing mutation.

Inside the same transaction SF then revalidates the target room/rate assignment, traveler occupancy, restrictions, physical capacity, availability windows, active holds, competing allocations, add-ons, and the fresh transactional price.

## Final booking mutation

After those checks, the final `HospitalityBooking` update repeats the validated snapshot in its `where` predicate rather than updating by booking ID alone. The predicate retains:

- booking ID and authenticated organization ID;
- `CONFIRMED` lifecycle and the observed `updatedAt` version;
- property, current room type, current rate plan, stay dates, and quantity;
- the observed payment status;
- currency and every persisted exact-money aggregate; and
- the prior pricing fingerprint.

If any of that state drifts before the write, Prisma cannot match the row and the serializable transaction fails rather than applying a commercial selection to stale authority.

## Final allocation mutation

The retained allocation moves in the same transaction. Its final mutation keeps the tenant/booking composite identity and also requires the validated property, prior room type, stay dates, and quantity. Allocation drift therefore rolls back the booking mutation instead of silently repairing or overwriting a different allocation snapshot.

## Idempotency, evidence, and audit

The existing tenant-scoped `booking.commercial-modified` audit event remains the durable idempotency ledger. Reuse of an idempotency key with a different modification fingerprint fails, and a completed retry is accepted only when the current commercial selection still matches the previously applied request.

After mutation, SF persists `BOOKING_COMMERCIAL_MODIFICATION` pricing evidence using the authoritative quote and updated booking version, then appends the booking audit event. Browser-supplied tenant identity, payment truth, inventory truth, money, or pricing fingerprint is never mutation authority.

## Similar-issue boundary

This review covers the direct zero-delta room/rate/quantity/add-on mutation and its booking/allocation persistence pair. Same-price date rescheduling and booking cancellation still use their own lifecycle contracts and should be reviewed independently before changing their persistence predicates. Non-zero amendments, provider money movement, traveler changes, and legal-document issuance have materially different acceptance criteria and remain outside this boundary.

## Validation

`scripts/zero-delta-commercial-modification-write-scope.test.mjs` is dependency-free and guards allocation coherence, the final booking/allocation predicates, permission and locking, zero-delta pricing, evidence, audit, and serializable execution.

The repository requires Node `>=24.20.0 <25`. Full Prisma generation/validation, TypeScript, lint, repository tests, production build, migration/drift checks, and PostgreSQL concurrency validation remain subject to the repository's normal local/manual environment gates. GitHub Actions are intentionally not used.
