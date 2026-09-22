# Non-hospitality inventory Prisma name authority

## Scope

The checked-in tour and appointment inventory migrations use compact production names for several PostgreSQL indexes and tenant-bound foreign keys. Prisma must map those physical names explicitly whenever its derived name would differ, otherwise `prisma migrate diff` can report drift even though the columns and relation tuples are correct.

This reconciliation changes Prisma metadata only. It does not rename database objects, rewrite inventory records, change lifecycle behavior, or weaken tenant scope.

## Appointment inventory

`prisma/migrations/20260914130000_appointment_inventory_foundation/migration.sql` intentionally uses compact names for service/staff identity and lookup indexes, staff/service tenant foreign keys, and schedule identity/window/lookup authority.

`prisma/appointment-inventory.prisma` maps those exact physical names. The schedule window unique key and schedule lookup index would otherwise derive names of 71 and 80 bytes, above PostgreSQL's 63-byte identifier limit. Explicit mapping also keeps the shorter migration names authoritative for the remaining appointment indexes and tenant foreign keys.

Staff/service and schedule relations remain composite across the resource ID and `organizationId`.

## Tour inventory

`prisma/migrations/20260914122000_tour_inventory_foundation/migration.sql` uses compact physical names for product lookup, departure/add-on tenant foreign keys, and child lookup indexes.

`prisma/tour-inventory.prisma` maps the exact names where Prisma's derived names differ. In particular, the implicit departure lookup name would be 64 bytes, so the compact migration name avoids PostgreSQL truncation ambiguity.

Departure and add-on relations remain composite across `tourProductId` and `organizationId`.

## Same-scope sweep

The rental inventory foundation was reviewed as part of the same physical-name-authority sweep. Its remaining unmapped keys and tenant foreign keys use the same names Prisma derives, while the three previously overlong availability/rate lookup indexes already use explicit compact mappings from `20260922092500-rental-inventory-identifier-portability`.

No additional rental migration or schema change is required by this reconciliation.

## Regression protection

`scripts/non-hospitality-inventory-prisma-name-authority.test.mjs` is a dependency-free source contract included by the repository `scripts/*.test.mjs` test glob. It verifies:

- appointment Prisma maps match the compact checked-in migration names;
- tour Prisma maps match the compact checked-in migration names;
- every mapped production name stays within PostgreSQL's 63-byte identifier limit;
- the exact overlong implicit names that motivated the mapping remain covered; and
- appointment/tour child relations retain composite tenant authority.

This source contract does not replace the Phase 1 live validation gate. Production-complete verification still requires the repository Node 24 toolchain, `prisma validate`/`prisma generate`, the complete migration chain on an explicitly disposable PostgreSQL target, drift verification, the database integration suite, and the normal production build validation. GitHub Actions are not used.
