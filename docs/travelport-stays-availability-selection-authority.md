# Travelport Stays Availability selection authority

## Purpose

Travelport Availability is the final read-only sell-authority step used by SF immediately before supplier reservation preparation. The reservation authority core already revalidates the selected SearchComplete offer, retrieves fresh Rules, parses bounded Availability pages, and requires a single selected booking-code/property/stay match. This provider-specific boundary pins the initial request, continuation result-set geometry, pagination token identity, and contradictory response evidence before any offer can be considered a provider submission reference.

This hardening does not advertise Travelport `reservation`, create a supplier booking, collect payment-card data, or relax any activation gate.

## Provider contract

Travelport's current v11 Hotel Availability documentation defines the initial Availability request as `POST /11/hotel/availability/catalogofferingshospitality` and the dedicated Availability Pagination reference defines continuation retrieval as `GET /11/hotel/availability/catalogofferingshospitality/{AvailabilityIdentifier}?pageNumber={x}`. The pagination reference says page 1 comes from the initial response, continuation page numbers are 2 through 5, pages do not need to be retrieved consecutively, and cached Availability results expire after 30 minutes.

The current Stays guide also defines `totalCatalogOffering` as the total number of rates across the result set, `catalogOfferingPerPage` as the number returned on the page, and `numberOfPages` as the total page count. When more than 100 rates exist, the initial response carries `CatalogOfferings.Identifier.value` for subsequent pagination. The same page-one identifier is the request authority used to retrieve every later page in that result set.

SF's reservation path intentionally issues a narrower Availability request than the provider's general capability: exactly one room, one property, one aggregator, one room-stay candidate, one to nine total guests, and at most one rate candidate derived from the freshly selected SearchComplete rate.

## SF selection authority rule

Before provider I/O, the Availability selection wrapper parses the exact serialized request body and requires:

- the fixed Travelport pre-production or production v11 Availability endpoint, POST, and no query string;
- one `CatalogOfferingsRequestHospitality` with `verboseResponseInd=true`;
- calendar-valid increasing stay dates;
- `numberOfRooms=1`;
- exactly one `AggregatorList` value, `TVPT` or `BKNG`;
- exactly one property with canonical chain/property codes;
- exactly one room-stay candidate with one adult guest-count entry followed by zero or more child entries, bounded to one through nine total guests; and
- when a rate candidate is present, one non-empty exact rate-code/rate-ID/rate-category selection, with a negotiated rate code bound to the same property.

Malformed request authority fails before network I/O. This is intentionally stricter than accepting arbitrary provider-valid Availability requests because the reservation authority core generates only this single-property/single-room shape.

For a successful Availability response, before the core can use an offer identifier as submission authority:

- every returned offer must identify the same supplier authority that SF requested;
- present rate-code, rate-ID, or rate-category evidence cannot contradict the requested rate candidate;
- present product guest count must equal the requested occupancy;
- present product quantity must prove at least the one requested room is available; and
- present product property/stay evidence must match the exact requested property and dates.

Optional response fields are not made mandatory when Travelport documentation or checked-in provider evidence does not prove universal presence. Missing optional evidence therefore does not invent authority; contradictory present evidence fails closed.

## Pagination continuity boundary

The reservation-authority response guard validates each successful Availability page independently: page geometry, collection ceilings, exact machine evidence, the page-one identifier rule, and the requested page being inside the page count reported by that response. The compatibility core also compares page totals/page counts after it receives the response.

The selection wrapper previously stored only the selected aggregator/property/stay/occupancy/rate authority against the page-one pagination token. It was later hardened to bind result-set geometry and provider origin, but a continuation response could still return a different `CatalogOfferings.Identifier.value` without that contradictory machine evidence being compared to the token SF had actually replayed. The compatibility core always reused the initial token for requests, so the changed response token was ignored rather than granted authority, but production software should reject contradictory provider evidence instead of silently discarding it.

The active token state now binds page-one pagination identity, geometry, and the exact Travelport API origin that issued it:

- each active token is keyed by the exact canonical Travelport API origin plus the opaque token, so pre-production and production continuation authority cannot cross;
- the same opaque token value may exist independently in pre-production and production without rebinding either environment's authority;
- `numberOfPages` is stored with the exact selection authority for every active multi-page token;
- `totalCatalogOffering` is stored when the production response-authority layer supplies it, which it requires for every successful Availability response;
- a continuation presented to the other Travelport environment has no matching active authority and fails before provider I/O;
- a continuation page above the page-one result-set page count fails before provider I/O;
- every successful continuation must keep the exact page-one `numberOfPages`, and production responses must keep the exact page-one `totalCatalogOffering`;
- when a continuation response includes `CatalogOfferings.Identifier.value`, that present continuation `CatalogOfferings.Identifier.value` must equal the active page-one token used in the request;
- the continuity boundary does not invent a requirement that Travelport repeat the identifier on every continuation response, so omission remains accepted when the rest of the response is authoritative;
- contradictory continuation token or geometry evidence fails before the active token can be consumed, so a later valid continuation can still be evaluated;
- the token is deleted only after selection evidence and pagination continuity both pass for the final page;
- an already-active pagination token cannot be rebound by a second initial result set, even if its reported geometry is identical; and
- non-consecutive page retrieval remains supported inside the established result set, matching Travelport's documented pagination behavior.

The token still expires after the provider's documented 30-minute cache window and active pagination authority remains capped at 64 entries. The production response guard remains responsible for full per-page geometry (`catalogOfferingPerPage`, expected page size, collection ceilings, and page-one identifier presence); this selection layer adds cross-page continuity rather than duplicating that complete parser.

## Similar-issue sweep

The surrounding fresh SearchComplete → Rules → Availability path was reviewed for the same pagination-state problem, provider-environment drift, and contradictory continuation token evidence. The reservation pre-write SearchComplete authority is intentionally pinned to one exact property on page 1 with `totalPages=1` and no continuation token, so there is no equivalent active continuation state there. The reservation authority core also derives SearchComplete and Availability endpoints from one validated credential environment, while the shared Travelport transport independently restricts credential-bearing I/O to that environment.

The separately advertised SearchComplete `hotel-search` capability does support continuation pages. Travelport's current guide says the initial SearchComplete `paginationToken` is the token to send for each additional page, so its public provider adapter now performs the same fail-closed rule: if a continuation response includes `pagination.paginationToken`, it must equal the exact token replayed in the request; omission remains allowed because the documentation does not establish universal repetition on continuation responses. Provider-specific token semantics remain in the Travelport adapters rather than the provider-neutral collector.

Repository search found no second reservation-authority pagination-state map; the Availability selection flow is the only current stateful continuation boundary in the reservation path. Rules continues to bind its response source and exact selected product to the outbound request. Create, reviewed Create, Sync, and known-locator recovery keep their separate pre-write, receipt, identity, and ambiguity contracts. No reservation-write behavior moved into this read-only module.

## Validation

Focused behavior coverage verifies:

- a pre-production pagination token cannot be used against production, or vice versa, and the rejected cross-environment attempt performs no delegated provider I/O;
- identical opaque token values can remain independently active on the two fixed Travelport API origins;
- continuation pages above the initial result-set page count fail before delegated provider I/O;
- `totalCatalogOffering` and `numberOfPages` remain exact across production continuations;
- a present continuation identifier that differs from the active page-one token is rejected without consuming the token state;
- a continuation response may omit the optional identifier without inventing a failure;
- rejected contradictory continuation evidence does not consume active token authority;
- non-consecutive continuation remains supported when it is inside the page-one result set;
- successful final-page retrieval consumes the token; and
- an active token cannot be rebound while its authority is still live.

The existing selection-authority coverage continues to verify canonical TVPT/BKNG selection, malformed-request rejection, supplier/rate/occupancy/property/stay contradiction handling, optional-evidence behavior, token expiry, final-page consumption, and unrelated/non-success passthrough. A dependency-free source contract pins origin-scoped token keys, request/response token continuity, stored pagination geometry, fail-before-I/O range checking, fail-before-mutation response comparison, same-origin active-token collision rejection, bounded TTL/capacity, and this documentation boundary.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised until the existing gates are complete:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-rules-selection-authority.md`
- `docs/travelport-stays-transport-token-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-stays-integration.md`
