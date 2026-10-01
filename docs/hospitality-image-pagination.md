# Hospitality image collection pagination

Hospitality property and room-type images are tenant-owned management collections. The management gallery must not silently truncate those collections or derive totals from the visible page.

## Management read boundary

`/inventory/[property-id]/images` uses `listHospitalityImagesPage`.

- reads require `inventory:read` before database access;
- every query repeats `organizationId`, `propertyId`, and the optional `roomTypeId`;
- page size defaults to 20 and is capped at 50 through the shared inventory pagination contract;
- the authoritative count, page clamp, and rows are observed in one PostgreSQL `RepeatableRead` transaction;
- ordering is deterministic by `isPrimary desc`, `sortOrder asc`, `createdAt asc`, then stable `id asc`; and
- the page renders the authoritative scoped total instead of treating the visible row count as the collection total.

The existing Prisma indexes already begin with the tenant/parent scope plus primary/display-order fields used by this reader. Stable date and ID ordering remains a deterministic tie-breaker.

## Legacy complete reader

`listHospitalityImages` remains for current complete-read callers such as integration coverage. It is not a management-page API.

The complete reader is tenant/parent scoped, deterministically ordered, reads at most 1,001 rows, and fails closed above the 1,000-row safety ceiling. It must not silently truncate commercial or presentation authority.

If a future workflow genuinely requires more than 1,000 images from one scope, that workflow needs an explicit paginated/searchable contract instead of increasing an implicit complete-read limit.

## Security

Pagination does not replace tenant isolation or authorization:

- the page still performs its existing authenticated organization authorization;
- the image service repeats `inventory:read`;
- mutations repeat `inventory:manage`;
- every database predicate remains tenant and parent scoped; and
- browser query parameters never establish ownership.

This change affects the management read model only. It does not change image creation, primary-image mutation, removal, storage policy, or provider behavior.
