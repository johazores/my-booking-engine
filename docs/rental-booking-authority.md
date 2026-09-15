# Rental booking conversion authority

SF has a server-only production authority review for deciding whether one active physical-unit hold and one active tenant customer can safely enter the durable rental booking writer. The review is intentionally read-only. It never consumes inventory or creates a booking itself.

## Authority boundary

`reviewRentalBookingConversionAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read` before it reads commercial, inventory, or customer data. Organization IDs come from the authenticated server context; a hold ID or customer ID never grants scope by itself.

The review runs as a serializable, read-only transaction and uses PostgreSQL `clock_timestamp()` as the expiry clock. It requires an effective tenant-owned `ACTIVE` hold, an active tenant customer, an active physical rental unit, its active unit type, and its active operating location. It rechecks overlapping unavailable-date blocks, competing effective holds, overlapping non-cancelled rental booking allocations, and all tenant-owned rate periods needed for the held date range.

Creation-time hold pricing remains evidence rather than a permanent price lock. Legacy holds without complete pricing evidence are not conversion-ready. If current tenant pricing differs from the immutable hold observation in currency, exact total, or pricing fingerprint, the authority fails closed with `PRICE_CHANGED`. Inventory contradictions fail closed with `INVENTORY_CONFLICT`.

Only a fully coherent review receives a deterministic SHA-256 `authorityFingerprint`. Version 1 binds the organization, hold, customer, physical unit, unit type, operating location, date range, exact hold expiry, currency, exact minor-unit total, and current pricing fingerprint. A change to any of those inputs produces a different authority.

## Durable write boundary

The review itself does **not** create a rental booking, consume the hold, allocate the unit, charge a customer, or change availability.

The durable writer is `confirmRentalBookingFromHold`, documented in [rental-booking-foundation.md](./rental-booking-foundation.md). The writer does not trust a previously successful review as current truth. It reacquires the tenant/unit serialization boundary and revalidates the active hold, customer, inventory conflicts, current price, and the exact authority fingerprint inside the serializable write transaction before it consumes the hold and creates the booking/allocation atomically.

This separation lets UI or application code present an explicit review step without creating a time-of-check/time-of-use permission or commercial-authority gap at persistence time.

## Product boundaries

The current first rental contract keeps the unit's active operating location as inventory metadata only. One-way return rules, delivery zones, opening hours, deposits, taxes/fees, payments, cancellation, amendments, customer self-service, and fulfillment notifications remain separate commercial acceptance criteria rather than being guessed here.

No route or primary action should present any of those capabilities as real until their server-side contracts exist.

## Validation

`src/server/bookings/rental-booking-authority-domain.test.ts` covers deterministic authority fingerprints and commercial-evidence rejection. `scripts/rental-booking-authority-source-contract.test.mjs` protects authorization, tenant scoping, database-clock expiry, inventory/pricing revalidation, booked-allocation awareness, exact authority binding, and the read-only review boundary.

Full repository validation still requires the repository-supported Node 24 environment. Prisma/database execution remains gated on an explicitly disposable PostgreSQL target. No GitHub Actions are required or used.
