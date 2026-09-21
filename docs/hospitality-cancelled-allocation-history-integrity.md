# Hospitality cancelled allocation history integrity

A cancelled hospitality booking releases sellable inventory because availability ignores allocations owned by `CANCELLED` bookings. The allocation row itself remains historical evidence of the room type, stay dates, and quantity that the retained booking owned at cancellation time.

## Cancellation coherence

`cancelHospitalityBooking` now requires the tenant-owned retained allocation to match the booking commercial inventory snapshot before it can apply `CONFIRMED -> CANCELLED`. The service checks organization, booking, property, room type, arrival date, departure date, and quantity under the existing booking and room-type allocation locks. Missing or mismatched allocation evidence fails closed before the lifecycle write.

This closes a stale/corrupt-state gap without adding a new mutation path. Supported reschedule and commercial-modification services remain the only application boundaries that can intentionally change effective allocation state while the booking is confirmed.

## Terminal allocation history

PostgreSQL rejects changes to `propertyId`, `roomTypeId`, `arrivalDate`, `departureDate`, or `quantity` after the owning booking is `CANCELLED`. This prevents direct SQL or an unsafe writer from rewriting the inventory history retained by a terminal booking after cancellation has released capacity.

The existing identity guard continues to protect allocation `id`, `createdAt`, `organizationId`, and `bookingId`. Together, the guards preserve both durable allocation identity and its final terminal inventory snapshot.

This migration deliberately does not change allocation deletion/retention semantics. A deletion guard requires coordinated teardown behavior across the complete database integration suite and remains a separate lifecycle decision.

## Validation

`scripts/hospitality-cancelled-allocation-history-integrity-source-contract.test.mjs` protects the cancellation coherence check, terminal PostgreSQL guard, guarded database regression, database-suite registration, and the availability/documentation contract.

The guarded database scenario creates a real hold, computes a current quote, confirms a booking, verifies cancellation fails closed when allocation quantity no longer matches the booking, restores coherent confirmed state, cancels through the production service, and then verifies direct allocation mutation is rejected after cancellation.

Full database execution still requires the repository Node 24 toolchain and an explicitly disposable PostgreSQL target. GitHub Actions are intentionally not used.
