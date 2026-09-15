# Rental booking conversion authority

SF now has a server-only production authority review for the next rental workflow dependency: deciding whether one active physical-unit hold and one active tenant customer can safely enter a future durable rental booking transaction.

## Implemented authority boundary

`reviewRentalBookingConversionAuthority` requires `booking:manage`, `availability:read`, `inventory:read`, `pricing:read`, and `customer:read` before it reads commercial, inventory, or customer data. Organization IDs come from the authenticated server context; a hold ID or customer ID never grants scope by itself.

The review runs as a serializable, read-only transaction and uses PostgreSQL `clock_timestamp()` as the expiry clock. It requires an effective tenant-owned `ACTIVE` hold, an active tenant customer, an active physical rental unit, its active unit type, and its active operating location. It then rechecks overlapping unavailable-date blocks, competing effective holds, and all tenant-owned rate periods needed for the held date range.

Creation-time hold pricing remains evidence rather than a price lock. Legacy holds without complete pricing evidence are not conversion-ready. If current tenant pricing differs from the immutable hold observation in currency, exact total, or pricing fingerprint, the authority fails closed with `PRICE_CHANGED`. Inventory contradictions fail closed with `INVENTORY_CONFLICT`.

Only a fully coherent review receives a deterministic SHA-256 `authorityFingerprint`. Version 1 binds the organization, hold, customer, physical unit, unit type, operating location, date range, exact hold expiry, currency, exact minor-unit total, and current pricing fingerprint. A change to any of those inputs produces a different authority.

## Deliberate write boundary

This review **does not create a rental booking**, consume the hold, allocate the unit, charge a customer, promise pickup/drop-off terms, or change availability. There is **no customer or staff booking action** exposed by this slice.

The future durable rental booking writer must revalidate this authority again inside the future write transaction while holding the same organization/unit serialization boundary. It must atomically establish customer ownership, immutable commercial evidence, unit allocation, and hold consumption, and must add confirmed-booking protection to availability and inventory-mutation guards before any booking action is exposed.

The current first rental contract also keeps the unit's active operating location as inventory metadata only. One-way return rules, delivery zones, opening hours, deposits, taxes/fees, payment, cancellation, and amendments remain separate commercial acceptance criteria rather than being guessed here.

## Validation

`src/server/bookings/rental-booking-authority-domain.test.ts` covers deterministic authority fingerprints and commercial-evidence rejection. `scripts/rental-booking-authority-source-contract.test.mjs` protects authorization, tenant scoping, database-clock expiry, inventory/pricing revalidation, exact authority binding, and the read-only/no-fake-booking boundary.

Full repository validation still requires the repository-supported Node 24 environment. Prisma/database execution is unchanged by this read-only slice and remains gated on an explicitly disposable PostgreSQL target. No GitHub Actions are required or used.
