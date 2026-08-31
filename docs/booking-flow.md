# Booking flow

## Status

SF has a production-safe internal hospitality flow from normalized offer search through atomic confirmation. Search discovers active tenant-owned room-type/rate-plan scopes, evaluates real availability and restrictions, requires complete persisted pricing, and returns only currently sellable offers. Selecting an offer carries the exact property, room type, rate plan, dates, and quantity into the authenticated booking desk, which rechecks availability before creating a hold.

A valid tenant-owned availability hold is converted into a confirmed booking and permanent occupied-night allocation in one serializable PostgreSQL transaction. The same transaction re-reads current persisted base rates, taxes/fees, and selected add-ons, recalculates the complete exact-money quote, validates booking-specific guest snapshots against room occupancy, persists those guest snapshots, consumes the hold, and writes the booking audit event.

Payments, cancellation/modification, and the public white-label booking journey remain incomplete and must not be presented as finished.

## Normalized hospitality search

`src/server/bookings/hospitality-search-service.ts` is the provider-independent internal discovery boundary. It requires both `availability:read` and `pricing:read`, derives organization scope server-side, optionally narrows to one tenant-owned property, and scans a bounded set of active room-type/rate-plan assignments.

For each candidate scope, search reuses canonical availability and complete pricing services. A result is returned only when the requested quantity is sellable after windows, restrictions, live holds, and permanent allocations, and when complete persisted pricing covers the stay. Search dates are canonicalized before downstream service calls, candidate evaluation runs in bounded batches, and equal-priced offers use stable resource identifiers for deterministic ordering.

The service evaluates at most 50 candidate room/rate scopes per request and returns at most 25 sellable offers. It returns total-scope plus truncation metadata so the authenticated UI never presents a partial broad search as exhaustive.

## Authenticated booking API

The internal API derives tenant identity from the active authenticated organization rather than accepting it from request payloads:

- `POST /api/bookings/hospitality/search` returns bounded currently sellable offers with complete pricing.
- `POST /api/bookings/hospitality/availability` reads normalized availability for an exact stay request.
- `POST /api/bookings/hospitality/holds` creates an idempotent temporary capacity hold.
- `POST /api/bookings/hospitality/quote` returns the current complete exact-money quote and deterministic fingerprint.
- `POST /api/bookings/hospitality/confirm` performs price-atomic hold-to-booking confirmation, including immutable guest snapshots.
- `GET /api/bookings/hospitality` returns tenant-scoped persisted booking history with bounded pagination.

Every endpoint requires an authenticated session and active organization. State-changing endpoints use same-origin protection. Service-layer permissions, tenant scope, availability locking, pricing calculation, guest validation, and persistence remain authoritative.

BigInt monetary values are serialized as decimal strings so JSON transport does not lose precision.

## Authenticated booking desk

`/bookings` lives in the canonical authenticated application shell. The page requires `booking:read` and exposes confirmation controls only with `booking:manage`.

The workflow is:

1. search active hospitality offers for stay dates and room quantity;
2. select a currently sellable property / room-type / rate-plan offer;
3. recheck authoritative availability;
4. select date-applicable add-ons;
5. create an idempotent capacity hold and fetch the complete server quote;
6. review exact accommodation, tax, fee, add-on, and total amounts;
7. select an active tenant customer;
8. capture one or more booking-specific guest snapshots, with the first guest prefilled from the selected customer but editable independently; and
9. submit the hold, current pricing fingerprint, selections, customer, guests, and stable booking idempotency key for atomic confirmation.

Guest first/last names are required, guest email is optional and canonicalized, and the total guest count cannot exceed `roomType.maxOccupancy × held room quantity` or the global 100-guest safety limit. Changing guest data invalidates the client booking idempotency attempt so a changed guest payload cannot accidentally reuse a completed request key. The server also includes guests in exact idempotency comparison.

Hold and booking idempotency keys remain stable across retryable client failures. Add-on choices are locked after capacity is held. Guest details may still be corrected before confirmation because they do not alter price or inventory quantity.

When confirmation reports a price change, the UI refreshes the quote and requires review. When the hold is unavailable or expired, stale commercial state is cleared and a new availability check is required. Successful confirmation shows persisted booking, payment state, guest count, and immutable total.

This is an internal staff booking desk, not the public white-label customer journey.

## Booking-specific guest snapshots

Guest data is deliberately separate from the reusable tenant `Customer` record. A customer can be the booker while the actual stay is for a different person or group, and later customer edits must not rewrite historical booking identity.

`HospitalityBookingGuest` stores ordered immutable guest snapshots with tenant ID, booking ID, position, first name, last name, optional canonical email, and creation time. Confirmation creates the guest rows inside the same serializable transaction as the booking, allocation, hold consumption, and audit event. Reads always scope guest rows by both `organizationId` and `bookingId`.

The current Prisma model keeps booking ownership as explicit scalar tenant/booking identifiers rather than exposing an ORM relation from the existing booking model. Application services are therefore the authoritative ownership boundary for this new table. A future schema consolidation may add a composite database foreign key when the booking model is next migrated; until then, SF does not hard-delete bookings, and all guest creation/read paths are transactionally scoped through validated tenant-owned bookings.

## Atomic confirmation

`confirmHospitalityBookingFromHold` requires `booking:manage`, validates tenant/resource identifiers, and executes in a serializable transaction. It serializes the organization/idempotency boundary, returns an existing booking only for an exact retry payload, acquires the shared room-type allocation lock, verifies the active unexpired hold and customer, revalidates the room/rate assignment and occupancy, recalculates complete persisted pricing, compares the deterministic fingerprint, creates the confirmed booking and ordered guest snapshots, creates the permanent allocation, consumes the hold, and writes one safe audit event.

The audit event records guest count but not guest names or email addresses, avoiding unnecessary PII duplication in audit payloads.

## Concurrency and no-overbooking

Hold creation and confirmation use the same room-type allocation advisory lock. Competing confirmation requests for the same final held unit are serialized; only one can consume the hold and create the permanent allocation. Exact retries of the winning idempotency key return the existing booking and its ordered guest snapshots without duplicate allocation, guests, or audit records.

The internal hospitality policy is no overbooking. Availability subtracts active unexpired holds and non-cancelled permanent booking allocations per occupied night.

## Pricing snapshot

Persisted hospitality bookings store currency, accommodation subtotal, tax total, fee total, add-on total, total, and complete pricing fingerprint using exact integer minor units. Total must equal the component sum. The snapshot is derived from current database pricing during confirmation and remains immutable booking history.

## Tenant isolation and authorization

Booking reads and writes always carry `organizationId` server-side. Hold, customer, room type, rate plan, booking, and allocation relations remain tenant constrained by their existing composite database relationships. Guest creation and reads additionally require the validated organization and booking ID in every query. Internal booking management requires explicit booking permissions; search also requires availability and pricing read capabilities.

## Validation coverage

Unit coverage includes normalized booking/search validation, guest normalization, canonical email handling, required names, guest-count bounds, idempotency payload matching, canonical date/quantity handling, and invalid calendar/range inputs. The disposable PostgreSQL booking suite continues to cover permission denial, cross-tenant denial, stale-price rollback, immutable server-derived totals, competing confirmation requests for one final held unit, idempotent retry, permanent allocation visibility in availability, bounded listing, and single audit-event persistence.

Full execution requires the repository Node 24 runtime and an explicitly disposable PostgreSQL target through the documented local database harness. GitHub Actions are intentionally not part of validation.

## Next dependency

The next major commercial dependency is payment orchestration. The public white-label journey should reuse the same real search, availability, hold, pricing, customer/guest, and confirmation contracts once its customer-safe authorization model is implemented. Provider-specific reservations remain behind future adapters rather than leaking into the internal booking domain.
