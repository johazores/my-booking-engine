# Zero-delta commercial modification write scope

SF applies room-type, rate-plan, quantity, and add-on changes directly only when a fresh server-side quote proves the aggregate persisted booking money is unchanged. This document records the defense-in-depth persistence boundary for that zero-delta path. It complements `docs/booking-management.md`, `docs/booking-commercial-adjustments.md`, and `docs/pricing.md`; it does not replace their product or settlement contracts.

## Authority and locking

`modifyHospitalityBookingCommercialTerms` requires `booking:manage`, derives tenant and actor identity from the authenticated server context, validates UUID inputs, and runs in a serializable transaction. The service takes the shared booking mutation advisory lock and stable current/target allocation locks before re-reading the tenant-owned booking.

The direct path is unavailable while a commercial amendment is active or while any booking payment is unresolved as `PENDING` or `AMBIGUOUS`. Price-changing changes are rejected and must use the versioned commercial-amendment settlement workflow instead.

## Allocation coherence

A confirmed booking is not sufficient by itself. The permanent `HospitalityBookingAllocation` must still match the booking snapshot for organization, booking, property, room type, quantity, arrival date, and departure date before availability or pricing authority is accepted. A mismatched allocation fails closed rather than being silently repaired by a commercial edit.

The target room/rate assignment, occupancy, restrictions, current physical capacity, availability windows, active holds, and competing allocations are all revalidated inside the same transaction before mutation.

## Final booking mutation

After a fresh transactional quote proves the aggregate price is unchanged, the final `HospitalityBooking` update repeats the validated authority in its `where` predicate. The write retains:

- booking ID and authenticated organization ID
- `CONFIRMED` lifecycle
- the exact observed booking `updatedAt` version
- property, current room type, current rate plan, arrival/departure dates, and quantity
- the observed payment status
- currency plus all persisted exact-money aggregates
- the prior pricing fingerprint

This prevents the final write from succeeding against a different tenant or a booking snapshot that drifted after validation. The transaction then writes the new commercial selection and accepted pricing fingerprint.

## Final allocation mutation

The allocation write keeps the organization/booking composite key and also repeats the validated property, current room type, arrival/departure dates, and quantity. If allocation state drifts, the allocation update fails and the serializable transaction rolls the booking mutation back.

The updated booking and allocation therefore move together or not at all.

## Idempotency, evidence, and audit

The existing tenant-scoped audit event remains the durable zero-delta idempotency record. Reuse of an idempotency key with another modification fingerprint is rejected; a completed retry is accepted only while the booking still matches the previously applied selection.

After mutation, SF persists append-only `BOOKING_COMMERCIAL_MODIFICATION` pricing evidence using the authoritative fresh quote and updated booking version, then writes the booking audit event in the same transaction. No browser-supplied money, tenant identity, allocation truth, or pricing fingerprint is accepted as mutation authority.

## Similar-issue boundary

This review covers the direct zero-delta commercial-modification service and its booking/allocation persistence pair. Same-price date rescheduling, traveler changes, cancellation, non-zero commercial amendments, payment/refund state machines, and legal-document issuance have different lifecycle and acceptance criteria and remain separate focused write-scope boundaries.

## Validation

The dependency-free source contract in `scripts/zero-delta-commercial-modification-write-scope.test.mjs` guards the final booking and allocation predicates, allocation-coherence check, permission/locking boundaries, fresh-price requirement, pricing evidence, audit, and serializable transaction.

The repository requires Node `>=24.20.0 <25` and full Prisma/PostgreSQL validation remains governed by the disposable-database gates in issue #1. GitHub Actions are intentionally not used for this repository.
