# Rental overdue-custody availability protection

A physical rental unit that has been picked up but not returned remains operationally available for later reservations until its committed rental period actually expires. Once the exclusive effective end date is reached in the booking location's IANA timezone and no return evidence exists, SF treats that unit as **overdue open custody** and removes it from new inventory authority until return is recorded or a supported custody extension moves the effective committed end later.

This is an inventory-integrity rule, not a late-fee or extension workflow. It does not alter booking dates, accepted money, settlement evidence, customer terms, or the append-only pickup/return history by itself.

## Time authority

Overdue status is evaluated from PostgreSQL `clock_timestamp()` and the retained booking location timezone. The pickup event remains immutable historical custody evidence and keeps the effective dates that existed when handoff occurred. If a supported post-pickup extension is later applied, the latest append-only reschedule target end becomes the current committed end for overdue authority while the pickup snapshot remains unchanged.

Pickup freezes cancellation, physical-unit replacement, and arbitrary date moves. The only supported post-pickup date mutation is the separate same-unit, current-start, later-end price-neutral custody extension; if one is applied, latest append-only reschedule evidence becomes the effective committed end used by custody reads and eventual return evidence.

The application reconciliation helper bounds open-custody evidence to 1,000 rows per scoped decision and fails closed if that safety limit is exceeded. This avoids silently returning incomplete availability when a tenant has an unexpectedly large unresolved custody set. For each picked-up booking it reads the latest tenant-scoped reschedule end and falls back to the immutable pickup end only when no later date-change evidence exists. An effective end earlier than the pickup snapshot is treated as an integrity error because supported in-custody changes can only extend custody.

## Protected decision surfaces

Overdue open custody is excluded or rejected by:

- rental availability search, before count/pagination so totals remain accurate;
- rental hold creation under the physical-unit advisory lock;
- stale hold-to-booking conversion review and final confirmation;
- same-unit reschedule/extension review when another overdue booking still retains the unit;
- pre-pickup same-type/same-location replacement-unit candidate discovery and target review; and
- physical-unit relocation, archival, and direct retyping so inventory identity cannot move while the unit is still retained by a customer.

The unit-substitution surface still closes once pickup exists. The date-change surface is custody-aware: before pickup it supports the existing price-neutral reschedule contract, while open custody accepts only a same-start/later-end price-neutral extension. Returned bookings close date-change authority entirely. Database guards independently enforce those boundaries.

## Staff operational visibility

Rental booking list and detail reads derive the same overdue-custody condition for staff instead of leaving the inventory block invisible. Each request obtains one PostgreSQL `clock_timestamp()` observation inside its existing `RepeatableRead` snapshot, uses the current effective exclusive `endsOn` date plus the retained booking location timezone, and exposes a read-only overdue flag with the expected-return boundary.

The booking list marks affected rows as **Overdue custody**. Booking detail shows an alert and changes the custody badge to **OVERDUE CUSTODY** while still exposing the real `Record return` action to authorized staff. When the actor also has date-change authority, the detail may expose the separate `Extend rental` review path; overdue visibility itself does not create a new mutable booking status and does not bypass the server/database inventory guards.

The booking list also provides an **Overdue only** operational queue. The queue is filtered in PostgreSQL before pagination rather than filtering an already paginated page in memory. Its count and page IDs use the same database observation time and the same confirmed + pickup + no-return + current effective local exclusive-end rule as the row-level custody projection. The SQL resolves that effective end from the latest tenant-scoped reschedule and falls back to the retained pickup end. Booking, location, pickup, return, and reschedule predicates all repeat `organizationId`, and the final row read repeats tenant scope again before rendering. The returned page is then re-derived through the normal custody domain and fails closed if the SQL queue and retained evidence disagree or any selected ID cannot be re-read in the same snapshot. This keeps the queue useful for large tenants without turning a resource ID or fulfillment row into tenant authority.

The queue is read-only. It does not automatically extend a rental, assess a fee, or close custody. Staff use the authorized `Record return` action to append return evidence or, when the separate date-change contract is eligible, explicitly review and apply a supported custody extension.

## Post-return commercial assessment

Once a real `RETURNED` event exists, the separate late-return assessment boundary can retain an explicit case-specific grace decision and either an exact positive fee authority or a waiver. It uses the effective committed end retained by fulfillment evidence, but it does not participate in inventory blocking while custody is still open and it does not move money.

See [rental-late-return-assessment.md](./rental-late-return-assessment.md).

## Database safety

The original overdue-custody migration added a tenant-aware `sf_rental_unit_has_overdue_custody` predicate using pickup evidence, absence of return evidence, confirmed booking state, and the booking location timezone. The custody-extension reconciliation migration replaces that database overdue predicate in place so it resolves the latest append-only reschedule target end before falling back to immutable pickup evidence. Existing hold, allocation, and substitution guards continue calling the same function and therefore inherit extension-aware custody authority without duplicating provider or commercial policy.

Supported hold creation and hold-to-booking confirmation acquire the existing physical-unit advisory lock before their service-level custody recheck. Allocation and substitution database guards acquire the same unit-lock namespace before evaluating overdue custody, so reschedule/extension and replacement final writes also fail closed if a stale or bypassed application path reaches persistence. A custody extension excludes its own booking from overdue-conflict detection while retaining conflicts from any other booking that physically holds the unit.

`20260919192500-rental-unit-mutation-custody-authority` also applies the shared overdue predicate to direct physical-unit lifecycle mutations. After the tenant/unit lock it samples PostgreSQL wall-clock time, evaluates current/future allocation boundaries in each booking's retained location timezone, then rejects relocation, retyping, or archival while overdue open custody remains. This closes the post-end gap where an allocation date alone was no longer enough to prove that the customer had returned the unit.

These database guards are defense in depth; they do not replace server authorization, tenant scope, idempotency, or service-level conflict handling.

## Interaction with early return

Return clears open custody through append-only `RETURNED` evidence. Return itself does not shorten the existing allocation, so live inventory remains protected through the committed end until staff explicitly apply early-return inventory release.

When an early-return release is valid, SF keeps the committed custody dates unchanged and shortens only the live allocation end to the first reusable whole rental day after the local return day. That separate append-only contract is documented in [rental-early-return-inventory-release.md](./rental-early-return-inventory-release.md).

## Validation

- `src/server/inventory/rental-custody-availability.test.ts` covers retained-location date authority and the exclusive-end overdue boundary.
- `src/server/bookings/rental-booking-custody-read-domain.test.ts` covers extension-aware staff custody projection and rejects impossible effective ends earlier than retained pickup evidence.
- `scripts/rental-overdue-custody-source-contract.test.mjs` protects inventory exclusion, write guards, current date-change semantics, and base staff visibility.
- `scripts/rental-overdue-custody-queue-source-contract.test.mjs` protects the tenant-scoped pre-pagination staff queue, shared PostgreSQL observation time, final row re-scope, and deliberate read-only commercial boundary.
- `scripts/rental-custody-extension-overdue-source-contract.test.mjs` protects application, staff-read, database, and documentation agreement on the latest effective custody end after extension.
- `scripts/rental-unit-mutation-custody-source-contract.test.mjs` protects relocation/archive application authority and the direct-write physical-unit mutation backstop.

## Deliberate boundaries

This protection does **not** itself implement a rental extension, automatic tenant-wide late-fee policy, fee settlement, damage charges, security-bond decisions, automatic customer notifications, replacement dispatch, maintenance transitions, or forced cancellation of later bookings. The separate reschedule lifecycle supports only a same-unit, current-start, later-end price-neutral custody extension. Price-changing or broader extensions remain a separate commercial amendment contract. The post-return late-return assessment is also a separate append-only commercial authority.

GitHub Actions are not required or used.
