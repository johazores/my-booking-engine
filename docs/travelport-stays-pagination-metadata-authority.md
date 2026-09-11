# Travelport Stays pagination-metadata authority

## Purpose

SearchComplete pagination metadata controls which provider result pages SF trusts and whether a response can become availability or pricing authority. Travelport documents that the initial SearchComplete response is page 1 and that continuation requests use page numbers 2 through 5 inclusive, with up to 100 properties per page.

Travelport also documents that the initial SearchComplete operation is `POST`, pagination is `GET`, and the pagination identifier is what authorizes retrieval of additional pages: when no identifier is returned there are no additional search results, while searches with additional pages return an identifier for follow-on GET requests.

SF therefore treats the HTTP method, request route/page, `page`, `pageSize`, `totalPages`, `totalItems`, and `paginationToken` presence as bounded machine authority rather than permissive presentation metadata.

## Response contract

The public Travelport adapter rejects successful SearchComplete responses when pagination metadata is internally impossible within SF's documented five-page / 100-items-per-page boundary.

The response must satisfy all of the following before the compatibility parser sees it:

- `page`, `pageSize`, `totalPages`, and `totalItems` are integers;
- `page` is between 1 and 5 inclusive;
- `pageSize` is between 0 and 100 inclusive;
- `totalPages` is between 0 and 5 inclusive;
- `totalItems` is between 0 and 500 inclusive;
- a non-empty result set cannot report a zero page size or zero total pages;
- the current page cannot exceed `totalPages` when `totalPages` is positive;
- a zero-page empty-result compatibility shape is valid only as page 1;
- `totalItems` cannot exceed the maximum capacity represented by `totalPages` at 100 properties per page;
- the initial operation must be `POST /12/hotel/search/searchcomplete` with no query parameters and its response must report page 1;
- a continuation operation must be `GET /12/hotel/search/searchcomplete/{SearchIdentifier}?pageNumber={x}` and its response must report the exact requested page; and
- on the initial response, `paginationToken` must be present exactly when `totalPages` reports that continuation pages exist.

The existing empty first-page shape `{ page: 1, pageSize: 0, totalPages: 0, totalItems: 0 }` remains accepted so this hardening does not invent properties or force a provider result where none exists.

Opaque `paginationToken` authority remains exact: no leading/trailing whitespace, no ASCII controls, and a maximum length of 4,096 characters. Follow-on callers remain limited to one opaque SearchComplete identifier path segment plus exactly one `pageNumber` query whose value is 2 through 5. The request method, route, and response page are bound together before the compatibility parser can interpret the provider payload.

For the initial response, token presence is cross-checked against `totalPages`. A response that claims additional pages without the token needed to retrieve them is rejected. A response that claims no continuation pages but still supplies a continuation token is also rejected. SF does not infer a supplier continuation path from contradictory metadata.

## Layering

The public Travelport adapter enforces provider-specific request-method, route, page, and token authority before delegating to the compatibility core. The provider-neutral complete-search collector continues to independently enforce first-page identity, total-page/item continuity, duplicate-property rejection, exact final item count, bounded page count, and non-exposure of provider pagination tokens.

These layers are intentionally independent. Direct callers of the provider should not be able to observe a page-2 payload as an initial SearchComplete result, trust a response attached to the wrong SearchComplete HTTP operation, or receive contradictory token/page-count authority merely because the higher-level complete-search collector would later reject it.

## Validation

Focused regression coverage rejects:

- page 0;
- pages above 5;
- page sizes above 100;
- total pages above 5;
- more than 500 total items;
- positive item counts paired with zero page size or zero total pages;
- a current page greater than the reported total page count;
- total item counts that exceed the capacity of the reported number of pages;
- an initial SearchComplete response that reports any page other than page 1;
- an initial multi-page response with no pagination token;
- an initial single-page response that presents a continuation token;
- `GET` used for the initial SearchComplete route;
- `POST` used for a continuation route; and
- query-bearing or nested route shapes outside the reviewed initial/continuation contracts.

Coverage also preserves the existing valid empty first-page compatibility shape. The dependency-free pagination contract pins the bounded metadata, exact HTTP method/route/page binding, and first-page token/page-count invariants at the public adapter boundary.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live Travelport verification still requires provisioned non-production credentials.

## Travelport references

- SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- SearchComplete Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm

## Related SF contracts

- `docs/travelport-stays-transport-token-authority.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-stays-commercial-authority.md`
