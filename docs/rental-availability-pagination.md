# Rental availability pagination

Rental availability search and the active temporary-hold directory are presentation/read-model collections. Both use the shared inventory pagination authority rather than trusting caller-provided offsets or page sizes.

## Server contract

`searchRentalInventoryAvailability` keeps the complete availability predicate tenant scoped and evaluates the database clock, availability count, pricing periods, resolved page, and returned unit rows inside the existing serializable transaction. After the scoped count is known, `resolveInventoryPagination` clamps an out-of-range requested page, applies the inventory default/maximum page-size rules, and supplies the only `skip`/`take` values used for the physical-unit page. The returned `search` and `availability` pagination state is the resolved server state so links and hold forms do not preserve stale caller pagination.

`listRentalAvailabilityHolds` observes one PostgreSQL clock inside a `RepeatableRead` transaction, counts only effective tenant-owned active holds (`status = ACTIVE` and `expiresAt > now`), resolves/clamps pagination from that count, and then reads the corresponding ordered page. The service uses the same inventory maximum of 50 rows even when it is called outside the current UI parser.

Both result sets keep deterministic ordering: available units by `name, id`, and effective holds by `expiresAt, id`.

## Commercial boundary

Pagination is presentation state only. It does not become rental inventory, pricing, hold-conversion, booking, settlement, pickup/return, or cancellation authority. Availability decisions continue to use complete scoped overlap predicates and the existing transaction/locking rules. Hold creation, pricing review, conversion, and release semantics are unchanged by this pagination hardening.

## Validation

`scripts/rental-availability-pagination-contract.test.mjs` protects server-side page clamping, the shared 50-row inventory ceiling, transaction isolation, tenant/effective-hold predicates, deterministic ordering, canonical returned pagination state, and the separation between paginated presentation reads and commercial authority.
