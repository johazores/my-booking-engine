# Rental booking conversion authority

SF has a server-only production authority review for deciding whether one active physical-unit hold and one active tenant customer can safely enter the durable rental booking writer. The review is intentionally read-only and never consumes inventory or creates a booking itself.

## Authority boundary

`reviewRentalBookingConversionAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read` before it reads commercial, inventory, or customer data. Organization identity comes from authenticated server context; hold/customer IDs never grant scope by themselves.

The review runs as a serializable transaction and uses PostgreSQL `clock_timestamp()` as the expiry clock. It requires an effective tenant-owned `ACTIVE` hold, active tenant customer, active physical unit, active unit type, and active operating location. It rechecks unavailable-date blocks, competing effective holds, overlapping non-cancelled booking allocations, and tenant rate periods needed for the held date range.

Creation-time hold pricing remains evidence rather than a permanent price lock. Legacy holds without complete evidence are not conversion-ready. Current currency, exact total, and pricing fingerprint must still match immutable hold evidence; otherwise authority fails closed. Inventory contradictions fail closed.

Only a fully coherent review receives deterministic SHA-256 `authorityFingerprint` version 1 binding organization, hold, customer, physical unit/type/location, dates, exact hold expiry, currency, exact minor-unit total, and current pricing fingerprint.

## Durable write boundary

The review itself does not create a rental booking, consume the hold, allocate the unit, charge a customer, or change availability.

`confirmRentalBookingFromHold`, documented in [rental-booking-foundation.md](./rental-booking-foundation.md), reacquires serialization locks and revalidates active hold/customer/inventory/current price plus the exact authority fingerprint before atomically consuming the hold and creating booking/allocation evidence.

This keeps browser-visible review separate from persistence authority and prevents time-of-check/time-of-use gaps.

## Downstream booking lifecycle

After confirmation, SF separately supports:

- terminal inventory-release cancellation, documented in [rental-booking-cancellation.md](./rental-booking-cancellation.md)
- same-unit price-neutral date rescheduling on the current effective unit with append-only evidence and fresh inventory/pricing authority, including later price-neutral reschedules/extensions after the one supported applied commercial amendment when the accepted effective total remains unchanged, documented in [rental-booking-reschedule-lifecycle.md](./rental-booking-reschedule-lifecycle.md)
- one server-authoritative same-unit price-changing commercial date amendment with exact retained manual/offline adjustment evidence, final locked apply, protected effective settlement, and post-apply manual refunds, documented in [rental-booking-commercial-amendments.md](./rental-booking-commercial-amendments.md) and [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md)
- same-type/same-location physical-unit substitution with append-only evidence and dual-unit serialization, including the supported post-amendment effective-commercial baseline, documented in [rental-booking-unit-substitution-authority.md](./rental-booking-unit-substitution-authority.md)

None of those downstream lifecycle changes is authority produced by the initial conversion review. Each reacquires its own current server authority under booking/current-inventory serialization.

## Product boundaries

The current rental contract still does not invent customer-selected pickup/drop-off promises, one-way return rules, delivery zones, opening hours, deposits, online/card/provider-backed rental settlement, taxes/fees beyond the existing daily-rate and retained late-return policy evidence, unit-type/location-changing substitutions, currency-changing amendments, a second/chained price-changing commercial amendment, customer self-service, fulfillment notifications, or external synchronization.

The supported price-changing contract is deliberately narrow: one same-unit rental date amendment with the existing manual/offline settlement and effective-refund boundaries. No route or primary action should present broader unsupported capabilities as real until their server-side contracts exist.

## Validation

`src/server/bookings/rental-booking-authority-domain.test.ts` covers deterministic authority fingerprints and commercial-evidence rejection. `scripts/rental-booking-authority-source-contract.test.mjs` protects authorization, tenant scope, database-clock expiry, inventory/pricing revalidation, booked-allocation awareness, exact authority binding, and the read-only conversion-review boundary.

Full repository validation requires the repository-supported Node 24 environment. Prisma/database execution remains gated on an explicitly disposable PostgreSQL target. No GitHub Actions are required or used.
