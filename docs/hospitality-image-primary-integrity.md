# Hospitality image primary database integrity

## Status

Hospitality image mutations already serialize primary selection inside one tenant/property/(optional room-type) gallery with a PostgreSQL transaction advisory lock. This database boundary adds an independent concurrency-safe backstop so a direct database write cannot persist two primary images in the same gallery.

## Database rule

Migration `20261002012000-hospitality-image-primary-integrity` installs two PostgreSQL unique expression indexes:

- property images are unique on the tenant/property identity only when `isPrimary` is true;
- room-type images are unique on the tenant/property/room-type identity only when `isPrimary` is true.

For non-primary rows each indexed expression evaluates to `NULL`. PostgreSQL normal unique-index null semantics therefore allow multiple non-primary rows while the concrete gallery identity for a primary row can occur only once.

The migration first scans retained rows and fails closed with a clear error if a gallery already contains more than one primary. It never silently selects a winner or rewrites historical data.

## Why an expression index

The persisted image model already has the correct `isPrimary` field and application lifecycle. A generated marker column would duplicate that state and require every writer to maintain two values.

PostgreSQL expression indexes provide the database invariant directly without changing the Prisma model or service contract. Prisma ORM 7 does not model PostgreSQL expression indexes in the Prisma schema, so this is intentionally represented in checked-in migration SQL rather than as a schema attribute.

## Application lifecycle

The database rule supplements, rather than replaces, the existing service behavior:

- image reads and writes remain tenant and parent scoped;
- writes require `inventory:manage`;
- creation, explicit primary selection, and removal use serializable transactions and the same-gallery advisory lock;
- the first image becomes primary;
- removing the current primary deterministically promotes the next image when one remains;
- destructive removal requires server-validated `REMOVE` confirmation; and
- safe audit evidence remains unchanged.

The unique indexes protect bypass paths and concurrent direct writes. They do not establish authorization or tenant ownership.

## Validation

`scripts/hospitality-image-primary-integrity-contract.test.mjs` verifies the checked-in SQL, scoped expressions, fail-closed retained-data preflight, identifier lengths, the serialized service lifecycle, and presence of direct-database regression coverage.

The guarded `src/server/inventory/hospitality.integration.ts` database suite also bypasses the image service to prove that non-primary rows and an independent property gallery remain valid while a second primary in the same property or room-type gallery is rejected with Prisma `P2002` and the authoritative primary remains unchanged.

That integration coverage runs only through `npm run test:database`; the migration and direct-database assertions still require execution against the repository's explicitly disposable PostgreSQL database gate before live-database validation can be claimed.
