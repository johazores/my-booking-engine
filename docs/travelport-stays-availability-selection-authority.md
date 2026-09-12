# Travelport Stays Availability selection authority

## Purpose

Travelport Availability is the final read-only sell-authority step used by SF immediately before supplier reservation preparation. The reservation authority core already revalidates the selected SearchComplete offer, retrieves fresh Rules, parses bounded Availability pages, and requires a single selected booking-code/property/stay match. This additional provider-specific boundary pins the initial Availability request itself and rejects contradictory response evidence before it can be considered a provider submission reference.

This hardening does not advertise Travelport `reservation`, create a supplier booking, collect payment-card data, or relax any activation gate.

## Provider contract

Travelport's current v11 Hotel Availability API documents:

- `POST /11/hotel/availability/catalogofferingshospitality` for the initial Availability request;
- `StayDates.start` and `.end` as the requested check-in/check-out dates;
- `HotelSearchCriterion.numberOfRooms` as 1 through 9;
- `AggregatorList` values `TVPT` (Travelport) and `BKNG` (Booking.com);
- one or more `PropertyRequest` values identifying the requested property;
- `RoomStayCandidates` / `GuestCount` as the occupancy request;
- optional `RateCandidates` used to constrain negotiated/category rate selection;
- `CatalogOffering.Identifier.authority` as the supplier system that returned the rate, either `TVPT` or `BKNG`;
- `Product.guests` as the number of guests and `Product.Quantity` as rooms available for the rate; and
- product `PropertyKey` and `DateRange` as property and stay evidence.

SF's reservation path intentionally issues a narrower request than the provider's general capability: exactly one room, one property, one aggregator, one room-stay candidate, one to nine total guests, and at most one rate candidate derived from the freshly selected SearchComplete rate.

## SF authority rule

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

For a successful initial Availability response, before the core can use an offer identifier as submission authority:

- every returned offer must identify the same supplier authority that SF requested;
- present rate-code, rate-ID, or rate-category evidence cannot contradict the requested rate candidate;
- present product guest count must equal the requested occupancy;
- present product quantity must prove at least the one requested room is available; and
- present product property/stay evidence must match the exact requested property and dates.

Optional response fields are not made mandatory when Travelport documentation or checked-in provider evidence does not prove universal presence. Missing optional evidence therefore does not invent authority; contradictory present evidence fails closed.

## Pagination boundary

Travelport documents Availability pagination as a separate GET using the identifier from page one and `pageNumber=2..5`, with Availability offers cached for 30 minutes. The existing reservation-authority response boundary validates that path, canonical pagination token encoding, page geometry, collection ceilings, and page-one identifier rules. The compatibility core additionally requires stable total/page counts across continuation pages, rejects duplicate offer identifiers, and allows only one selected sell match across the complete result set.

The selection wrapper now carries the initial single-selection authority across continuation pages as bounded, in-memory token state. A page-one pagination token is associated only with the exact initial aggregator/property/stay/occupancy/rate authority, expires after the provider's documented 30-minute cache window, and the wrapper caps active token authorities at 64. A continuation request with an unknown, expired, malformed, or already-completed token fails closed before provider I/O. Successful continuation responses are checked against the same supplier, rate, occupancy, quantity, property, and stay authority before the compatibility core can use them. The token binding is deleted after the final page.

## Similar-issue sweep

The surrounding SearchComplete → Rules → Availability path was reviewed for the same "requested one authority, silently ignore contradictory provider evidence" pattern. Rules now binds its response source and exact selected product to the outbound request. Availability previously filtered non-matching supplier/rate evidence while searching for one usable offer, which meant contradictory entries could coexist with an accepted match. This wrapper closes that ambiguity across both the initial page and token-bound continuation pages and also binds present occupancy, room-quantity, property, stay, and rate-candidate evidence.

Create, reviewed Create, Sync, and known-locator recovery keep their separate pre-write, receipt, identity, and ambiguity contracts. No reservation-write behavior moved into this read-only module.

## Validation

Focused dependency-free behavior coverage verifies:

- canonical TVPT and BKNG request/response authority;
- malformed request rejection before provider I/O;
- supplier-authority mismatch rejection;
- guest-count, room-quantity, property, and stay contradiction rejection;
- rate-candidate contradiction rejection;
- compatibility for absent optional response evidence;
- token-bound continuation-page authority and rejection of unbound/reused tokens; and
- passthrough of unrelated/non-success traffic.

A source contract pins composition after the existing reservation response guard and confirms the module remains read-only.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised until the existing gates are complete:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-rules-selection-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-stays-integration.md`
