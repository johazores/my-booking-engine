# Travelport Stays integration

## Purpose

This document defines SF's first production external hospitality supplier boundary. The implemented read-side boundary covers complete normalized hotel discovery, exact-money SearchComplete offer pricing, mandatory fresh offer revalidation, normalized Travelport v11 Rules evidence, credential authentication, and connection health verification. Customer-facing supplier reservation, modification, and cancellation remain closed until their provider-specific write contracts are implemented end to end.

## Provider identity and tenant ownership

SF uses provider code `travelport-stays`. Each configured record is owned by exactly one organization through the existing `Integration` model and is managed through `integration:manage`. The browser cannot submit an organization ID or capability list.

The server derives the implemented capability list as `availability`, `hotel-search`, and `pricing`. Migration `20260906033000_travelport-stays-pricing-capabilities` upgrades active/disabled Travelport records to that capability set while deliberately leaving archived capability history unchanged. Reservation, modification, cancellation, refund, ticketing, and flight capabilities are not advertised.

Operational supplier reads use product permissions rather than integration-administration permissions. Property discovery requires tenant-scoped `availability:read`. Offer pricing, revalidation, and booking-rule review require both `availability:read` and `pricing:read`. All permission checks complete before the active encrypted Travelport integration is loaded, so credential access never substitutes for product authorization.

## Credentials and token lifecycle

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the existing encrypted integration credential envelope. Provider endpoints are fixed constants selected from the validated environment; callers cannot supply arbitrary URLs.

Travelport documents a 24-hour TripServices access-token lifetime and token reuse. SF caches tokens in process by Integration ID plus credential version, suppresses duplicate concurrent refreshes, refreshes before expiry, and evicts a cached token after provider authentication rejection. Rotation changes the cache key automatically. The Rules adapter uses the same credential-version cache authority for its v12 bridge and v11 Rules requests. Token values and credential headers are never returned, logged, audited, or persisted outside the encrypted credential envelope.

## Property discovery and pagination

`HospitalitySupplierProvider` owns the provider-neutral property-search contract. Search input is bounded to city IATA code, local stay dates, room/adult counts, optional child ages, and radius. Travelport v12 SearchComplete is called with `returnOnlyAvailableProperties: true` and responses are rebuilt into SF-owned property records.

A property result contains only an opaque `supplierPropertyReference`, display name, normalized nullable property type, and availability. The opaque reference carries the Travelport chain/property identity and authority needed for an exact-property follow-up; provider-specific identifiers are not exposed as first-class product fields.

SearchComplete page 1 can return up to 100 properties. The documented continuation endpoint is `GET search/searchcomplete/{SearchIdentifier}?pageNumber={x}` for pages 2 through 5. SF consumes at most five pages / 500 properties, requires stable totals, rejects duplicate property references and page mismatches, and never returns the opaque Travelport pagination token from the complete product search result.

## Exact offer pricing contract

`HospitalitySupplierPricingProvider` extends the normalized supplier contract with exact-property offer search and revalidation. `searchPropertyOffers` accepts the opaque property reference, stay/occupancy, and requested three-letter currency. The Travelport adapter issues a v12 SearchComplete request using `propertyKeys`, `requestedCurrency`, `returnOnlyAvailableProperties: true`, and `returnCompleteNightlyRateBreakdown: true`.

Pricing requests add Travelport's `TVP-Cache-Control: no-cache` header. Travelport documents this as the real-time pricing mode, but also instructs consumers to make a final price check before booking. SF therefore does **not** assign a trusted offer TTL. Every normalized result has `validUntil: null`, `providerCacheMode: NO_CACHE`, and `revalidationRequired: true`.

Provider decimal amounts are converted through SF's shared currency/minor-unit money boundary. Rates are rejected when currency is malformed/mixed, amount precision exceeds the currency's runtime minor-unit precision, mandatory totals are absent, the response exceeds bounded room/rate limits, or a duplicate provider rate identity is returned. SF does not perform floating-point commercial arithmetic.

Each normalized offer includes opaque property/offer references, room/rate descriptions, bounded available quantity, exact integer-minor money, normalized rate terms/inclusions, and a deterministic SHA-256 `offerFingerprint`. `rulesRequiredBeforeReservation: true` remains part of the SearchComplete observation because SearchComplete terms are not accepted as final rule authority.

## Revalidation semantics

`revalidatePropertyOffer` always performs another no-cache exact-property SearchComplete request. The caller supplies the selected offer reference, expected exact total, and expected normalized offer fingerprint. The adapter verifies ownership and returns `UNCHANGED`, `PRICE_CHANGED`, `OFFER_CHANGED`, or `UNAVAILABLE`.

Revalidation still returns `validUntil: null`. It is a fresh observation, not a durable reservation guarantee.

## Pre-reservation Rules authority

`HospitalitySupplierBookingTermsProvider` is the provider-neutral rule-evidence boundary. The Travelport implementation uses the v11 full-payload Rules endpoint `rules/offershospitality/buildfromrequest`; no Travelport request model or raw identifier is exposed through the booking domain.

The current SearchComplete offer reference intentionally contains only the opaque rate identity required for product-safe revalidation. Travelport v11 Rules additionally needs the provider `bookingCode` and, when returned, rate-code details. The Rules adapter therefore performs an internal no-cache exact-property SearchComplete bridge, matches exactly one selected `rateKey`, verifies the expected currency and exact total, and extracts `bookingCode` plus optional `rateCode` / `ratePlanID` / `rateCategory` only inside the provider adapter.

The full Rules request sends the selected property, dates, one-room occupancy, exact stored amount/currency, Travelport/Booking aggregator authority, and documented guest-count structure. Travelport Rules allows one to nine guests for this request. SF deliberately rejects multi-room Rules review today rather than inventing undocumented room-candidate semantics for the v12-to-v11 bridge; multi-room supplier booking remains a future independently verified provider capability.

Rules responses are normalized into bounded SF-owned evidence:

- exact integer-minor base/tax/fee/total money;
- payment timing and recognized guarantee types;
- loyalty/check-in qualification requirements;
- structured cancellation deadlines and amount/percent/night penalties;
- deposit due dates and exact money;
- accepted payment-card codes, check-in/check-out times, and bounded rule text;
- a deterministic `termsFingerprint` over the normalized evidence;
- `completeForReservationReview` and `revalidationRequired: true`.

Unknown guarantee semantics never become booking authority: they normalize to `UNKNOWN` and keep `completeForReservationReview` false. Unsupported cancellation-penalty structures fail closed. A successful Rules response is also discarded unless a final no-cache `revalidatePropertyOffer` still returns `UNCHANGED` after the Rules call. This closes the obvious race where the provider offer changes while full rules are being fetched.

Rules evidence still does **not** authorize or create a reservation. A future reservation write must persist durable tenant-owned idempotency/recovery state, re-check provider truth, and handle provider price/guarantee changes explicitly. SF must never silently send Travelport `acceptPriceChangeInd=true` or `acceptGuaranteeChangeInd=true` without a separately reviewed user/commercial decision.

## Failure and privacy contract

Provider failures normalize to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INVALID_REQUEST`, or `INVALID_RESPONSE`. Only rate-limit, provider-unavailable, and timeout are retryable. Malformed provider data, forged opaque references, unsupported authority, unsafe page tokens, mixed currencies, invalid money precision, ownership mismatches, unsupported Rules shapes, and oversized/duplicate result structures fail closed.

Raw Travelport errors, credentials, tokens, access groups, request headers/bodies, provider response bodies, pagination tokens, rate keys, booking codes, property keys, and supplier commercial data are not copied into product errors or structured request logs.

## Management and observability

`POST /api/integrations/travelport-stays` configures or rotates the tenant-owned integration. `POST /api/integrations/travelport-stays/test` performs the explicit administrator health check and records only normalized current-credential health evidence. Existing integration enable/disable/archive/reconnection semantics remain provider-neutral.

Supplier discovery, pricing, revalidation, and Rules review are server services only. There is still no customer-facing external-supplier booking route, fake reservation action, or mock Travelport success path.

## Validation boundary

The supplier suite covers configuration and fixed endpoints, token request/caching/eviction, health failure normalization, SearchComplete discovery, bounded pagination, opaque identity, exact-money offer normalization, no-cache pricing, commercial fingerprints, revalidation, and Rules request/normalization/race handling. Dependency-free source contracts check permission-before-credential-load ordering, provider isolation, the Rules endpoint, final offer revalidation, and the continued absence of reservation/automatic price-or-guarantee acceptance code.

Live provider validation still requires a specifically provisioned Travelport non-production account. Full migration/drift/database execution still requires the repository's explicitly disposable PostgreSQL target. Neither is claimed by source-only validation.

## Remaining work before supplier reservation

1. Design durable supplier reservation persistence with tenant-owned supplier references, exact idempotency, ambiguous-outcome recovery, retry semantics, and provider-truth retrieval.
2. Define the first supported Travelport reservation write for the already-proven single-room Rules boundary; keep provider price/guarantee change acceptance explicit and fail-closed.
3. Only then expose a real staff/customer supplier search/selection/reserve surface with complete loading, empty, error, accessibility, and responsive states.
4. Expand independently to verified multi-room and provider-supported retrieve/modify/cancel semantics rather than assuming they match the first reservation path.
5. Execute live non-production provider integration tests with provisioned credentials outside source control.

## Current Travelport references

- SearchComplete v12: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- SearchComplete pagination: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- Hotel Rules full payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- Hotel Rules response/reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Create Reservation full payload/change checks: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
