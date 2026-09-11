# Travelport Stays transport-token authority

## Purpose

Travelport configuration credentials, OAuth bearer tokens, and SearchComplete pagination identifiers cross transport boundaries before provider data can become pricing or reservation authority. They are opaque machine values, not presentation text. SF therefore preserves their exact spelling and fails closed instead of silently trimming or control-normalizing them.

This contract strengthens the active `availability`, `hotel-search`, and `pricing` integration and the existing reservation foundation. It does not advertise the Travelport `reservation` capability or relax any Phase 15 activation gate.

## Credential authority

The public Travelport adapter now owns the normalization boundary for configured credentials before delegating to the compatibility core. `username`, `password`, `clientId`, `clientSecret`, and `accessGroup` must be:

- non-empty strings;
- within the existing field-specific length limits;
- free of ASCII controls `U+0000` through `U+001F` and `U+007F`; and
- already exact, with no leading or trailing whitespace that would change the submitted credential.

This keeps SF from saving or authenticating with a credential value different from the value the tenant actually supplied. Existing persisted Travelport credentials were already stored from the normalized public configuration flow; this change does not rewrite encrypted historical integration records.

The environment remains restricted to the fixed `pre-production` and `production` allowlist. Provider endpoints remain code-owned rather than tenant-controlled.

## OAuth bearer-token authority

Travelport's successful OAuth response is inspected at the public provider transport boundary before the compatibility parser can cache or use the token. `access_token` must be a non-empty exact string, at most 16,384 characters, with no outer whitespace and no ASCII controls.

The guard applies to:

- direct `requestTravelportStaysAccessToken` callers;
- the integration health probe;
- the active SearchComplete/pricing provider;
- Rules retrieval; and
- the existing reservation Create, reviewed-Create, Sync, and known-locator recovery implementations that import the public token helper.

Authentication failures and provider status handling remain unchanged. The token is not logged, persisted as audit detail, or exposed to browser code by this boundary.

## SearchComplete pagination authority

Travelport documents SearchComplete pagination as an opaque `paginationToken` returned by SearchComplete and replayed in `search/searchcomplete/{SearchIdentifier}?pageNumber={x}`. Page numbers are documented as 2 through 5, with up to 100 properties per page.

SF now validates pagination before the compatibility parser or follow-on request can normalize/replay it:

- a present `paginationToken` must be non-empty, exact, at most 4,096 characters, and free of the full ASCII control range;
- caller-supplied follow-on page tokens use the same exact rule before any OAuth or provider request is attempted;
- `page`, `pageSize`, `totalPages`, and `totalItems` must be non-negative integers;
- page and total-page metadata cannot exceed five pages;
- page size cannot exceed 100; and
- total item metadata cannot exceed the bounded five-page / 500-item SearchComplete collection used by SF.

The provider-neutral complete-search collector still performs its independent cross-page checks: first-page shape, total-page/total-item continuity, duplicate property references, exact final item count, and no pagination-token exposure in its returned domain object.

## Compatibility-contract repair

The Travelport provider was previously split into a hardened public authority adapter and a `*-core.ts` compatibility implementation. The dependency-free pagination contract still asserted several implementation details against the public adapter even though those details had moved to the compatibility core. That made the contract stale and capable of failing the default local test command for the wrong reason.

The contract now checks each responsibility at its actual boundary:

- public adapter: exact references, credentials, OAuth token authority, and pagination replay/response authority;
- provider core: fixed SearchComplete pagination endpoint, documented page-number bounds, page-result matching, pricing normalization, and no-cache revalidation behavior;
- Rules public adapter: hardened authority wrapping; and
- Rules core: provider request construction and fresh revalidation mechanics.

This is a test-contract repair only; it does not weaken production assertions.

## Validation

Focused regression coverage pins:

- padded and ASCII-control-bearing configuration credentials are rejected;
- padded and ASCII-control-bearing OAuth tokens cannot become bearer authority;
- the integration health probe does not report healthy when OAuth authority is malformed;
- padded/control-bearing SearchComplete pagination tokens fail before compatibility parsing;
- provider pagination metadata outside the five-page / 500-item boundary fails closed; and
- padded/control-bearing pagination replay identifiers fail before any provider request.

Dependency-free source contracts also pin the public/core responsibility split so future compatibility refactors do not silently invalidate the test suite.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Travelport references

- SearchComplete Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- Stays APIs Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm

## Related SF contracts

- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-stays-integration.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
