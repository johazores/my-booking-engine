# Booking flow

## Status

SF now has a production-safe internal hospitality flow from broad offer search through atomic confirmation. Search discovers active tenant-owned room-type/rate-plan scopes, evaluates real availability and restrictions for the requested stay, requires complete persisted pricing, and returns only currently sellable offers. Selecting an offer carries the exact property, room type, rate plan, dates, and quantity into the authenticated booking desk, which rechecks availability before any capacity hold is created.

A valid tenant-owned availability hold is converted into a confirmed booking and permanent occupied-night allocation in one serializable PostgreSQL transaction. The same transaction re-reads current persisted base rates, taxes/fees, and selected add-ons, recalculates the complete exact-money quote, and rejects a stale pricing fingerprint before booking, allocation, hold-consumption, or audit writes commit.

Booking-specific traveler/passenger capture, payments, cancellation/modification, and the public white-label booking journey remain incomplete and must not be presented as finished.

## Normalized hospitality search

`src/server/bookings/hospitality-search-service.ts` is the current provider-independent internal discovery boundary. It requires both `availability:read` and `pricing:read`, derives organization scope server-side, optionally narrows to one tenant-owned property, and scans a bounded set of active room-type/rate-plan assignments.

For each candidate scope, search reuses the canonical availability and complete pricing services. A result is returned only when the requested quantity is sellable after windows, restrictions, live holds, and permanent allocations, and when complete persisted pricing covers the stay. Unavailable or unpriced candidates are omitted rather than represented as bookable inventory. Search dates are canonicalized before downstream service calls, candidate evaluation is processed in bounded batches to avoid an unbounded burst of database/service work, and equal-priced offers use stable resource identifiers for deterministic ordering.

The service evaluates at most 50 candidate room/rate scopes per request and returns at most 25 sellable offers. It also returns the total matching scope count plus explicit `scopeLimitReached` and `resultLimitReached` metadata. The authenticated booking UI surfaces those limits instead of silently presenting a partial broad search as exhaustive; staff can narrow by property when the candidate limit is reached.

The authenticated `/bookings` page exposes this as a real search form. Selecting a result preloads the exact offer and stay into the booking desk, but the desk intentionally requires a fresh availability check before the user can hold capacity. Search is discovery, not a reservation guarantee.

## Authenticated booking API

The internal application boundary uses the active authenticated organization context rather than accepting tenant identity from request payloads:

- `POST /api/bookings/hospitality/search` returns bounded currently sellable hospitality offers with complete pricing.
- `POST /api/bookings/hospitality/availability` reads normalized availability for an exact property/room-type/rate-plan stay request.
- `POST /api/bookings/hospitality/holds` creates the real idempotent temporary capacity hold.
- `POST /api/bookings/hospitality/quote` returns the current complete exact-money quote and deterministic pricing fingerprint, including selected add-ons.
- `POST /api/bookings/hospitality/confirm` performs price-atomic hold-to-booking confirmation.
- `GET /api/bookings/hospitality` returns tenant-scoped persisted booking history with bounded pagination.

Every booking-flow endpoint requires an authenticated session and an active organization selected through the server-side tenant context. State-changing endpoints use same-origin protection. Service-layer permissions, tenant scope, availability locking, pricing calculation, and persistence remain authoritative rather than route handlers or UI filtering.

BigInt monetary values are serialized as decimal strings so JSON transport does not lose precision.

## Authenticated booking desk

`/bookings` lives in the canonical authenticated application shell and derives the active tenant from the validated server session. The page uses `booking:read` for access and exposes confirmation controls only when the actor also has `booking:manage`.

The current workflow is:

1. search across active hospitality offers for stay dates and room quantity;
2. select a currently sellable property / room-type / rate-plan offer;
3. recheck authoritative availability for that exact offer;
4. select date-applicable add-ons;
5. create an idempotent capacity hold and fetch the complete server quote;
6. review exact accommodation, tax, fee, add-on, and total amounts;
7. select an active tenant customer; and
8. submit the hold, current pricing fingerprint, selections, customer, and stable booking idempotency key for atomic confirmation.

Hold and booking idempotency keys remain stable across retryable client failures so a lost HTTP response cannot create duplicate temporary capacity or duplicate bookings. Changing commercial stay input starts a fresh hold attempt. Add-on choices are locked after capacity is held so the UI cannot silently abandon a live hold by changing its commercial payload.

When confirmation reports a price change, the UI refreshes the current quote and requires review before retry. When the hold is unavailable or expired, stale commercial state is cleared and a new availability check is required. Successful confirmation shows the persisted booking identifier, booking state, separate payment state, and immutable total.

This is an internal staff booking desk, not the public white-label customer journey.

## Atomic confirmation

`confirmHospitalityBookingFromHold` requires `booking:manage`, validates tenant/resource identifiers, and executes in a serializable transaction. It serializes the organization/idempotency boundary, returns an existing booking only for an exact retry payload, acquires the shared room-type allocation lock, verifies the active unexpired hold and customer, revalidates the room/rate assignment, recalculates complete persisted pricing, compares the deterministic fingerprint, creates the confirmed booking and permanent allocation, consumes the hold, and writes one safe audit event.

All pricing, booking, allocation, hold, and audit reads/writes above share the same database transaction. A stale price therefore cannot consume inventory or create a partial booking.

## Concurrency and no-overbooking

Hold creation and confirmation use the same room-type allocation advisory lock. Competing confirmation requests for the same final held unit are serialized; only one can consume the hold and create the permanent allocation. Exact retries of the winning idempotency key return the existing booking without duplicate allocation or audit records.

The internal hospitality policy is no overbooking. Availability subtracts active unexpired holds and non-cancelled permanent booking allocations per occupied night.

## Pricing snapshot

Persisted hospitality bookings store currency, accommodation subtotal, tax total, fee total, add-on total, total, and complete pricing fingerprint using exact integer minor units. Total must equal the component sum. The snapshot is derived from current database pricing during confirmation and remains immutable booking history.

## Tenant isolation and authorization

Booking reads and writes always carry `organizationId` server-side. Hold, customer, room type, rate plan, booking, and allocation relations are independently tenant constrained by composite database relationships. Search likewise never accepts browser tenant identity and only scans active assignments inside the authenticated organization. Internal booking management requires explicit booking permissions; search also requires availability and pricing read capabilities.

## Validation coverage

Unit coverage includes normalized booking/search validation, including canonical date/quantity handling and invalid calendar/range inputs. The disposable PostgreSQL booking integration suite covers permission denial, cross-tenant denial, stale-price rollback, immutable server-derived totals, competing confirmation requests for one final held unit, idempotent retry, permanent allocation visibility in availability, bounded listing, and single audit-event persistence.

Full execution requires the repository Node 24 runtime and an explicitly disposable PostgreSQL target through the documented local database harness. GitHub Actions are intentionally not part of validation.

## Next dependency

The highest-value remaining booking-flow dependency is booking-specific traveler information where fields or multiple travelers must differ from the tenant customer record. After that, payment orchestration is the next major commercial dependency. The public white-label journey should reuse the same real search, availability, hold, pricing, and confirmation contracts once its customer-safe authorization model is implemented. Provider-specific reservations remain behind future adapters rather than leaking into the internal booking domain.
