# Hospitality booking guest evidence integrity

Hospitality booking traveler rows are retained booking-specific evidence. The supported traveler workflow may replace the ordered guest set while a booking is confirmed, but a retained booking with established traveler evidence must never lose its complete guest set and cancellation freezes the final traveler snapshot.

## Retention at the database boundary

The initial integrity migration preflights existing `HospitalityBooking` rows and fails if any retained booking already has no matching tenant-owned guest row. Production confirmation continues to create the booking and its normalized ordered guests inside the established serializable confirmation transaction; no alternate raw booking-creation workflow is introduced by this hardening.

Guest deletion is checked at transaction commit. Confirmed-booking traveler replacement remains compatible because `updateHospitalityBookingGuests` deletes the old ordered set and creates the normalized replacement set inside one serializable transaction. A transaction that starts from retained guest evidence and leaves the retained booking with zero guests is rejected.

The final migration deliberately keeps booking creation authority in the production confirmation boundary instead of making every raw `HospitalityBooking` insert depend on fixture construction order. It removes the temporary booking-insert constraint from the migration chain and replaces it with a terminal transition guard: a booking cannot transition into `CANCELLED` unless retained guest evidence exists at that point.

Controlled database-test teardown remains possible when guest rows and their parent booking are removed in the same transaction because the deferred deletion guard observes that the booking is no longer retained at commit.

## Mutation and terminal history

Guest rows are replace-only: PostgreSQL rejects direct `UPDATE` statements. This matches the production traveler service, which performs an authorized, tenant-scoped delete/create replacement rather than mutating individual guest rows in place.

The database also rejects a transition into `CANCELLED` when the booking has no retained guest evidence. Once the owning booking is `CANCELLED`, the final traveler snapshot is terminal history. PostgreSQL rejects adding a new guest immediately and rejects deleting any retained guest at transaction commit while the cancelled booking still exists. Together with the global update guard, cancelled guest history cannot be inserted into, rewritten, or partially deleted outside coherent booking teardown.

The database rules do not add new traveler-management authority. Application writes still require `booking:manage`, the shared booking mutation lock, confirmed lifecycle state, occupancy validation, normalized traveler data, idempotency, and minimized audit metadata.

## Validation

`scripts/hospitality-booking-guest-evidence-integrity-source-contract.test.mjs` protects the migration preflight, deferred guest-retention guard, replace-only mutation rule, cancellation-transition authority, cancelled-history guards, compatibility with the serializable traveler replacement service, guarded PostgreSQL scenario registration, and the documentation boundary.

The guarded PostgreSQL scenario confirms a real booking through production availability/pricing/confirmation services, rejects direct guest-row updates and removal of all retained guest evidence, proves the authorized serializable traveler replacement still works, cancels through the production lifecycle service, and then rejects terminal guest insertion, rewrite, or deletion. The scenario also uses the deferred teardown path that removes guest/allocation/booking evidence together.

The migrations and scenario are exercised by `npm run test:database`, which deploys the complete checked-in migration chain before booking scenarios run. Full live execution still requires the repository Node 24 toolchain and an explicitly disposable PostgreSQL target. GitHub Actions are intentionally not used.
