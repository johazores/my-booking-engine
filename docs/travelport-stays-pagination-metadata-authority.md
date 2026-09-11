# Travelport Stays pagination-metadata authority

## Purpose

Travelport pagination metadata controls which provider result pages SF trusts and whether a response can become availability, pricing, or reservation authority. SF treats provider page metadata, continuation identifiers, HTTP methods, continuation routes, and successful response envelopes as bounded machine authority rather than presentation metadata.

This contract covers two independent paths:

- the active v12 SearchComplete discovery/pricing path; and
- the v11 Availability recheck used by the deliberately disabled reservation-authority path.

The second path does not advertise or enable the Travelport `reservation` capability. It only hardens the evidence that would be required before that capability can safely become available.

## SearchComplete pagination authority

Travelport documents that the initial SearchComplete response is page 1 and that continuation requests use page numbers 2 through 5 inclusive, with up to 100 properties per page.

Travelport also documents that the initial SearchComplete operation is `POST`, pagination is `GET`, and the pagination identifier is what authorizes retrieval of additional pages: when no identifier is returned there are no additional search results, while searches with additional pages return an identifier for follow-on GET requests.

SF therefore treats the HTTP method, request route/page, `page`, `pageSize`, `totalPages`, `totalItems`, `paginationToken` presence, and required successful-response envelope as bounded machine authority rather than permissive presentation metadata.

### SearchComplete response contract

The public Travelport adapter rejects successful SearchComplete responses when pagination metadata is internally impossible within SF's documented five-page / 100-items-per-page boundary.

The response must satisfy all of the following before the compatibility parser sees it:

- the successful response body is valid JSON with a record root, a `pagination` record, a `hotelsResponse` record, and a `hotelsResponse.propertyItems` array;
- `page`, `pageSize`, `totalPages`, and `totalItems` are integers;
- `page` is between 1 and 5 inclusive;
- `pageSize` is between 0 and 100 inclusive;
- `totalPages` is between 0 and 5 inclusive;
- `totalItems` is between 0 and 500 inclusive;
- a non-empty result set cannot report a zero page size or zero total pages;
- the only canonical empty result is page 1 with `pageSize: 0`, `totalPages: 0`, `totalItems: 0`, and an empty property collection;
- the current page cannot exceed `totalPages` when `totalPages` is positive;
- `totalItems` cannot exceed the maximum capacity represented by `totalPages` at 100 properties per page;
- for non-empty results, `totalPages` must equal the page count implied by `totalItems` at 100 properties per page;
- for non-empty results, every non-final page must report `pageSize: 100` and the final page must report the exact remainder;
- the actual `hotelsResponse.propertyItems` length must equal `pageSize`;
- the initial operation must be `POST /12/hotel/search/searchcomplete` with no query parameters and its response must report page 1;
- a continuation operation must be `GET /12/hotel/search/searchcomplete/{SearchIdentifier}?pageNumber={x}` and its response must report the exact requested page; and
- on the initial response, `paginationToken` must be present exactly when `totalPages` reports that continuation pages exist.

The canonical empty first-page shape `{ page: 1, pageSize: 0, totalPages: 0, totalItems: 0 }` remains accepted so this hardening does not invent properties or force a provider result where none exists. Zero-item responses that claim a positive page count, a positive page size, or a continuation page are rejected rather than being interpreted as valid empty authority.

Opaque `paginationToken` authority remains exact: no leading/trailing whitespace, no ASCII controls, and a maximum length of 4,096 characters. Follow-on callers remain limited to one canonically percent-encoded opaque SearchComplete identifier path segment plus exactly one canonically encoded `pageNumber` query whose value is 2 through 5. The request method, route, and response page are bound together before the compatibility parser can interpret the provider payload.

For the initial response, token presence is cross-checked against `totalPages`. A response that claims additional pages without the token needed to retrieve them is rejected. A response that claims no continuation pages but still supplies a continuation token is also rejected. SF does not infer a supplier continuation path from contradictory metadata.

A successful SearchComplete HTTP response cannot bypass this boundary by returning non-JSON content or omitting the required pagination/property collection envelope. Those shapes fail closed at the authority adapter even though the compatibility core also validates its own required response structure. The two layers remain deliberately independent.

## Availability pagination authority

Travelport documents that Hotel Availability returns at most 100 rates per page. When more than 100 rates exist, `CatalogOfferings/Identifier/value` is returned and the client retrieves pages 2 through 5 with `GET /11/hotel/availability/catalogofferingshospitality/{AvailabilityIdentifier}?pageNumber={x}`. The initial Availability operation is `POST /11/hotel/availability/catalogofferingshospitality` with no query string.

Travelport also defines the Availability pagination fields as:

- `totalCatalogOffering`: total rates across the full result set;
- `catalogOfferingPerPage`: rates returned on the current page;
- `numberOfPages`: total pages created for the request; and
- `Identifier/value`: the continuation identifier, returned only when more than 100 rates are found.

For multi-page results, every non-final page contains 100 rates and the final page contains the remainder. SF now binds those documented invariants to the reservation-authority response before its compatibility parser can select a provider submission reference.

The Availability authority guard requires:

- all three pagination counters to be integers;
- `totalCatalogOffering` to remain between 0 and 500;
- `catalogOfferingPerPage` to remain between 0 and 100;
- `numberOfPages` to remain between 1 and 5;
- `numberOfPages` to equal the page count implied by the total at 100 rates per page, with the empty result represented as one page;
- the requested page not to exceed the provider-declared page count;
- `catalogOfferingPerPage` to equal the exact documented size for the requested page;
- the actual `CatalogOffering` array length to equal `catalogOfferingPerPage`;
- the initial response to include an exact bounded pagination identifier when and only when more than one page exists; and
- any continuation identifier that is returned to remain an exact bounded machine token.

This means an initial `101`-rate result must report `100` rates on page 1, two pages, and a continuation identifier; page 2 must report exactly one rate. A single-page result cannot present a continuation identifier.

## Provider I/O ordering

SearchComplete method and route authority is materialized before the wrapped provider transport is invoked. An initial request using the wrong method, a continuation using the wrong method, an initial route carrying a query, or an unreviewed nested/query shape fails before `fetchImpl` can perform provider I/O.

The reservation-authority response guard now applies the same preflight principle to its own narrow request set. Its fresh SearchComplete call is limited to the exact initial `POST` route. Availability is limited to the exact initial `POST` route or a canonical one-segment continuation `GET` carrying exactly one `pageNumber=2..5` query. Malformed methods, nested paths, duplicate queries, non-canonical query encodings, and unsupported page numbers fail before provider I/O.

This ordering is intentional. These boundaries do not only validate responses; they also prevent malformed or accidentally broadened provider operations from reaching Travelport before the authoritative response expectations have been established.

## Layering

The public SearchComplete adapter enforces provider-specific request-method, route, page, token, response-envelope, and zero-result authority before delegating to the compatibility core. The provider-neutral complete-search collector continues to independently enforce first-page identity, total-page/item continuity, duplicate-property rejection, exact final item count, bounded page count, and non-exposure of provider pagination tokens.

The reservation-authority adapter independently validates the exact fresh SearchComplete/Availability machine evidence before its compatibility core can use Availability identifiers as immediate sell authority. The environment-bound Travelport transport remains a separate defense that restricts allowed Travelport hosts, headers, bodies, routes, methods, query shapes, response sizes, redirects, and versioned trace headers.

These layers are intentionally independent. A compatibility parser should never make contradictory pagination metadata authoritative merely because another outer layer would usually reject it.

## Validation

Focused SearchComplete regression coverage rejects malformed page counters, mismatched response pages, contradictory initial token/page-count authority, wrong methods, unreviewed route/query shapes, non-canonical zero-item geometries, successful non-JSON responses, and successful responses missing required pagination/property envelopes. The method/route regression asserts zero underlying provider calls for rejected request authority. Coverage preserves the one canonical empty first-page result.

Focused Availability reservation-authority coverage verifies:

- valid `101`-rate page geometry (`100` on page 1, `1` on page 2);
- impossible total/page-count combinations;
- incorrect non-final or final page sizes;
- missing multi-page continuation identifiers;
- unexpected single-page continuation identifiers;
- padded/control-bearing pagination identifiers;
- wrong initial and continuation HTTP methods;
- page numbers outside `2..5`;
- duplicate or nested continuation route/query shapes; and
- zero provider calls when request authority fails preflight.

The same-scope sweep also corrected a stale SearchComplete mismatched-page fixture so it now uses coherent positive pagination metadata; the regression therefore reaches the response-page mismatch assertion instead of failing earlier on the page-size guard. Existing reservation-authority pagination fixtures were aligned with Travelport's documented rule that a multi-page Availability response begins only after 100 rates.

Dependency-free source coverage pins SearchComplete canonical-empty/envelope authority, both preflight orderings, and the Availability five-page / 100-rate geometry. Available local validation uses Node type stripping and focused dependency-free execution. Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live Travelport verification still requires provisioned non-production credentials.

The reservation capability remains disabled pending the reviewed PCI-safe FormOfPayment/guarantee source, live non-production SearchComplete → Rules → Availability → Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less recovery semantics.

## Travelport references

- Stays APIs Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm
- Hotel Availability API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Availability Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_AvailPagination.htm
- SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- SearchComplete Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm

## Related SF contracts

- `docs/travelport-stays-request-tracing.md`
- `docs/travelport-stays-transport-token-authority.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-commercial-authority.md`
