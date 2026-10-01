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

## Collection boundary

`listHospitalityImagesPage` is the single image-collection read boundary. Management UI and PostgreSQL integration coverage both use the same tenant-scoped paginated contract, so there is no parallel bounded "complete" reader that can be mistaken for complete collection authority.

Any future workflow that needs to traverse an entire gallery must iterate explicit pages or introduce a purpose-specific cursor contract. It must not add a hidden synchronous row ceiling and treat the resulting prefix as complete authority.

## Primary-image mutation lifecycle

Image creation, explicit primary selection, and removal use serializable transactions plus one transaction-scoped PostgreSQL advisory lock per tenant/property/optional-room-type gallery. This serializes primary-authority decisions inside one gallery without blocking unrelated galleries.

When the current primary image is removed and another image remains, the same transaction promotes the next deterministic image by display order, creation time, then ID. Removal audit evidence records the promoted image ID when promotion occurs. Removing the final image leaves the gallery empty. Destructive removal additionally requires the server to validate an explicit `REMOVE` confirmation.

## Security

Pagination does not replace tenant isolation or authorization:

- the page still performs its existing authenticated organization authorization;
- the image service repeats `inventory:read`;
- mutations repeat `inventory:manage`;
- every database predicate remains tenant and parent scoped;
- browser query parameters never establish ownership; and
- successful and validation redirects preserve the current room-type directory page and image page as presentation state only.

The management read model remains separate from mutation authority. Image mutations retain tenant and parent scoping, and same-gallery primary-image changes now use serialized lifecycle handling. Storage policy and provider behavior are unchanged. Database-level single-primary enforcement is documented in `docs/hospitality-image-primary-integrity.md`.
