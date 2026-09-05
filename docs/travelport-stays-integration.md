# Travelport Stays integration

## Purpose

This document defines SF's first production external hospitality supplier boundary. The implemented boundary now covers complete normalized hotel discovery, exact-money SearchComplete offer pricing, mandatory fresh offer revalidation, credential authentication, and connection health verification. Customer-facing supplier reservation, modification, and cancellation remain closed until their provider-specific write contracts are implemented end to end.

## Provider identity and tenant ownership

SF uses provider code `travelport-stays`. Each configured record is owned by exactly one organization through the existing `Integration` model and is managed through `integration:manage`. The browser cannot submit an organization ID or capability list.

The server derives the implemented capability list as `availability`, `hotel-search`, and `pricing`. Migration `20260906033000_travelport-stays-pricing-capabilities` upgrades active/disabled Travelport records to that capability set while deliberately leaving archived capability history unchanged. Reservation, modification, cancellation, refund, ticketing, and flight capabilities are not advertised.

Operational supplier reads use product permissions rather than integration-administration permissions. Property discovery requires tenant-scoped `availability:read`. Offer pricing and revalidation require both `availability:read` and `pricing:read`. All permission checks complete before the active encrypted Travelport integration is loaded, so credential access never substitutes for product authorization.

## Credentials and token lifecycle

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the existing encrypted integration credential envelope. Provider endpoints are fixed constants selected from the validated environment; callers cannot supply arbitrary URLs.

Travelport documents a 24-hour TripServices access-token lifetime and token reuse. SF caches tokens in process by Integration ID plus credential version, suppresses duplicate concurrent refreshes, refreshes before expiry, and evicts a cached token after provider authentication rejection. Rotation changes the cache key automatically. Token values and credential headers are never returned, logged, audited, or persisted outside the encrypted credential envelope.

## Property discovery and pagination

`HospitalitySupplierProvider` owns the provider-neutral property-search contract. Search input is bounded to city IATA code, local stay dates, room/adult counts, optional child ages, and radius. Travelport v12 SearchComplete is called with `returnOnlyAvailableProperties: true` and responses are rebuilt into SF-owned property records.

A property result contains only an opaque `supplierPropertyReference`, display name, normalized nullable property type, and availability. The opaque reference now carries the Travelport chain/property identity and authority needed for a later exact-property rate request; provider-specific identifiers are not exposed as first-class product fields.

SearchComplete page 1 can return up to 100 properties. The documented continuation endpoint is `GET search/searchcomplete/{SearchIdentifier}?pageNumber={x}` for pages 2 through 5. SF consumes at most five pages / 500 properties, requires stable totals, rejects duplicate property references and page mismatches, and never returns the opaque Travelport pagination token from the complete product search result.

## Exact offer pricing contract

`HospitalitySupplierPricingProvider` extends the normalized supplier contract with exact-property offer search and revalidation. `searchPropertyOffers` accepts the opaque property reference, stay/occupancy, and requested three-letter currency. The Travelport adapter issues a v12 SearchComplete request using `propertyKeys`, `requestedCurrency`, `returnOnlyAvailableProperties: true`, and `returnCompleteNightlyRateBreakdown: true`.

Pricing requests add Travelport's `TVP-Cache-Control: no-cache` header. Travelport documents this as the real-time pricing mode, but also instructs consumers to make a final price check before booking. SF therefore does **not** assign a trusted offer TTL. Every normalized result has `validUntil: null`, `providerCacheMode: NO_CACHE`, and `revalidationRequired: true`.

Provider decimal amounts are converted through SF's shared currency/minor-unit money boundary. Rates are rejected when currency is malformed/mixed, amount precision exceeds the currency's runtime minor-unit precision, mandatory totals are absent, the response exceeds bounded room/rate limits, or a duplicate provider rate identity is returned. SF does not perform floating-point commercial arithmetic.

Each normalized offer includes:

- opaque property and offer references;
- room/rate descriptions and bounded available quantity;
- exact integer-minor base, tax, total, included-fee, and property-due fee amounts where supplied;
- currency and provider flags such as taxes/resort-fee inclusion and predicted price movement;
- normalized refundability, payment timing, guarantee type, qualification/loyalty requirements, cancellation note/penalties, and common inclusions;
- a deterministic SHA-256 `offerFingerprint` over the normalized commercial observation;
- `revalidationRequired: true` and `rulesRequiredBeforeReservation: true`.

The fingerprint is not a provider secret or booking authority. It exists so a same-price change to quantity, terms, penalties, inclusions, or other normalized commercial fields cannot be mistaken for an unchanged offer.

## Revalidation semantics

`revalidatePropertyOffer` always performs another no-cache exact-property SearchComplete request. The caller supplies the selected offer reference, expected exact total, and expected normalized offer fingerprint. The adapter verifies that the offer belongs to the selected property and returns one of:

- `UNCHANGED` — the same provider rate identity, exact total, and normalized commercial fingerprint are still present;
- `PRICE_CHANGED` — the provider rate identity remains but the exact total changed;
- `OFFER_CHANGED` — the exact total is unchanged but other normalized commercial fields changed;
- `UNAVAILABLE` — the previous provider rate identity is no longer returned.

Revalidation still returns `validUntil: null`. It is a fresh observation, not a durable reservation guarantee. Travelport's v11 Rules API remains mandatory SF work before any reservation write because SearchComplete itself can return estimated/incomplete cancellation or nightly-rate information and Travelport documents Rules as the place to confirm rate rules.

## Failure and privacy contract

Provider failures normalize to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INVALID_REQUEST`, or `INVALID_RESPONSE`. Only rate-limit, provider-unavailable, and timeout are retryable. Malformed provider data, forged opaque references, unsupported authority, unsafe page tokens, mixed currencies, invalid money precision, ownership mismatches, and oversized/duplicate result structures fail closed.

Raw Travelport errors, credentials, tokens, access groups, request headers/bodies, provider response bodies, pagination tokens, rate keys, property keys, and supplier commercial data are not copied into product errors or structured request logs.

## Management and observability

`POST /api/integrations/travelport-stays` configures or rotates the tenant-owned integration. `POST /api/integrations/travelport-stays/test` performs the explicit administrator health check and records only normalized current-credential health evidence. Existing integration enable/disable/archive/reconnection semantics remain provider-neutral.

Supplier discovery/pricing are server services only. There is still no customer-facing external-supplier booking route, fake reservation action, or mock Travelport success path.

## Validation boundary

The supplier suite covers configuration and fixed endpoints, token request/caching/eviction, health failure normalization, SearchComplete discovery, bounded pagination, opaque property identity, exact-money offer normalization, provider-specific no-cache pricing, terms/penalties, deterministic commercial fingerprints, unchanged/price-changed/non-price-changed/unavailable revalidation, forged reference rejection, mixed currency/precision rejection, and duplicate rate rejection. A dependency-free source contract also checks permission-before-credential-load ordering, provider-cache/revalidation/rules boundaries, and capability-migration scope.

Live provider validation still requires a specifically provisioned Travelport non-production account. Full migration/drift/database execution still requires the repository's explicitly disposable PostgreSQL target. Neither is claimed by source-only validation.

## Remaining work before supplier reservation

1. Implement the Travelport v11 Rules adapter contract for a selected rate and normalize the rule evidence required immediately before reservation.
2. Design durable supplier reservation persistence with tenant-owned supplier references, exact idempotency, ambiguous-outcome recovery, retry semantics, and provider-truth retrieval.
3. Only then expose a real staff/customer supplier search/selection/reserve surface with complete loading, empty, error, accessibility, and responsive states.
4. Add provider-supported retrieve/modify/cancel only after each write/read capability is independently verified and safely persisted.
5. Execute live non-production provider integration tests with provisioned credentials outside source control.

## Current Travelport references

- SearchComplete v12: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- SearchComplete pagination: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- Stays FAQ / cache and final-price guidance: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelFAQ.htm
- Stays API references / Rules and Reservations: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/HotelAPIReferences.htm
