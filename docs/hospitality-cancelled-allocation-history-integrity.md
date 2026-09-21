# Hospitality cancelled allocation history integrity

A cancelled hospitality booking releases sellable inventory because availability ignores allocations owned by `CANCELLED` bookings. The allocation row itself remains historical evidence of the room type, stay dates, and quantity that the retained booking owned at cancellation time.

## Cancellation coherence

`cancelHospitalityBooking` requires the tenant-owned retained allocation to match the booking commercial inventory snapshot before it can apply `CONFIRMED -> CANCELLED`. The service checks organization, booking, property, room type, arrival date, departure date, and quantity under the existing booking and room-type allocation locks. Missing or mismatched allocation evidence fails closed before the lifecycle write.

This closes a stale/corrupt-state gap without adding a new mutation path. Supported reschedule and commercial-modification services remain the only application boundaries that can intentionally change effective allocation state while the booking is confirmed.

## Terminal allocation history

PostgreSQL rejects changes to `propertyId`, `roomTypeId`, `arrivalDate`, `departureDate`, or `quantity` after the owning booking is `CANCELLED`. This prevents direct SQL or an unsafe writer from rewriting the inventory history retained by a terminal booking after cancellation has released capacity.

The existing identity guard continues to protect allocation `id`, `createdAt`, `organizationId`, and `bookingId`. Together, the guards preserve both durable allocation identity and its final terminal inventory snapshot.

## Allocation retention

Every retained hospitality booking must keep its allocation row. A migration-time preflight rejects an existing booking that is already missing allocation evidence, and a deferred PostgreSQL constraint trigger rejects deleting an allocation while its tenant-owned booking still exists.

The deletion guard is status-independent. It protects live `PENDING_CONFIRMATION`/`CONFIRMED` inventory authority as well as terminal `CANCELLED` history instead of allowing a direct database writer to remove capacity or historical evidence by deleting the allocation row.

The trigger is deferred until transaction commit so controlled teardown remains possible: test or administrative cleanup may delete the allocation and its owning booking in the same transaction. A standalone allocation deletion cannot commit while the booking remains retained.

This retention guard does not add a product booking-delete workflow. Production cancellation remains a retained lifecycle transition, and application booking-management surfaces do not gain destructive deletion authority.

## Validation

`scripts/hospitality-cancelled-allocation-history-integrity-source-contract.test.mjs` protects cancellation coherence, the terminal update guard, status-independent allocation retention, migration-time preflight, guarded database coverage, coordinated database-fixture teardown, database-suite registration, and the availability/documentation boundary.

The guarded database scenario creates a real hold, computes a current quote, confirms a booking, verifies cancellation fails closed when allocation quantity no longer matches the booking, restores coherent confirmed state, verifies direct allocation deletion cannot remove live booking evidence, cancels through the production service, then verifies both terminal allocation mutation and deletion are rejected while the booking remains retained.

Full database execution still requires the repository Node 24 toolchain and an explicitly disposable PostgreSQL target. GitHub Actions are intentionally not used.
