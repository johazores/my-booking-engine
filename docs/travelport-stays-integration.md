# Travelport Stays integration

## Purpose

This document defines SF's first production external hospitality supplier boundary. It is intentionally narrower than the full Travelport TripServices Stays surface: the implemented capability is complete normalized hotel search plus credential authentication/health verification. Pricing authority and reservation lifecycle remain closed until their provider-specific contracts are implemented end to end.

## Provider identity and tenant ownership

SF uses provider code `travelport-stays`. Each configured record remains owned by exactly one organization through the existing `Integration` model and can be managed only through `integration:manage`. The server derives the active organization from the authenticated session before configuration or health testing. The browser cannot submit an organization ID or capability list.

The server always derives the capability list as `hotel-search`. This prevents a configured Travelport record from claiming pricing, reservation, modification, cancellation, refund, ticketing, or flight capability before corresponding code exists.

Operational supplier search is a separate product authority from credential management. `searchHospitalitySupplierProperties` requires tenant-scoped `availability:read` before loading the active encrypted Travelport integration. This allows authorized hospitality staff to use supplier search without granting them integration credential-management authority. No browser-supplied organization ID is accepted by this service.

## Credentials

Travelport's current TripServices documentation requires these values:

- environment: `pre-production` or `production`;
- username;
- password;
- client ID;
- client secret;
- access group.

All six are stored inside the existing encrypted integration credential envelope. Environment is stored with the credential set so the browser cannot choose a runtime endpoint after configuration. All provider endpoints are fixed constants selected from the validated environment; arbitrary base URLs are rejected by construction.

The integration UI never receives existing credential values. Rotating/reconnecting requires the complete fresh credential set and increments the Integration credential version. Archive keeps non-secret audit/provider history but destroys the encrypted credential envelope using the existing lifecycle implementation.

## OAuth token lifecycle

Travelport documents a 24-hour TripServices access-token lifetime and requires applications to cache and reuse tokens. SF follows that contract with an in-process cache keyed by the immutable Integration ID plus credential version:

- a credential rotation automatically changes the cache key, so a token from an older credential version cannot serve the new configuration;
- concurrent requests for the same cache key share one pending token request;
- the cache refreshes before the documented expiry;
- token values are never returned from the provider adapter, audited, logged, or persisted to the Integration record;
- a process restart or a separate application instance may obtain its own token. The implementation still avoids per-request token creation and remains inside Travelport's documented authentication boundary.

The authentication request uses the provider-documented password-grant fields. A connection test deliberately requests a fresh token so that it verifies the currently stored credentials rather than a cached token.

## Search contract

`HospitalitySupplierProvider` is the provider-neutral contract. `searchProperties` accepts normalized bounded input:

- city IATA code;
- local check-in and check-out date;
- room count;
- adult count;
- optional child ages;
- optional bounded radius in kilometres.

The Travelport adapter calls v12 SearchComplete with `returnOnlyAvailableProperties: true`. The response is rebuilt into SF-owned data rather than returning Travelport JSON. Each property contains only:

- opaque `supplierPropertyReference`;
- display name;
- normalized nullable property-type text;
- availability boolean.

Prices and rate objects are intentionally not projected from SearchComplete yet. Travelport's price/rate/offer model must be normalized with exact money, currency, expiry/cache authority, rules and booking reference semantics before SF advertises `pricing`, `availability`, or `reservation` capability.

## SearchComplete pagination

Travelport SearchComplete returns page 1 and up to 100 properties. When additional results exist, its pagination metadata returns an opaque `paginationToken`. Travelport's current pagination API retrieves pages with `GET search/searchcomplete/{SearchIdentifier}?pageNumber={x}`, accepts page numbers 2 through 5, sends no request body, and keeps the paging identifier available for 30 minutes.

SF models that provider behavior without leaking it into product code:

- the provider-neutral contract carries only an opaque `pageToken` plus a bounded page number;
- the Travelport adapter URL-encodes that token and permits only page numbers 2 through 5;
- every pagination response must identify the page actually requested;
- the same credential-version token cache and normalized failure handling are used for initial and continuation requests;
- the server-side complete-search collector allows at most five pages / 500 properties, requires stable `totalPages` and `totalItems` across continuation pages, rejects duplicate supplier property references, and fails closed when a page is missing or inconsistent;
- all pages are consumed before the product result is returned, so the opaque Travelport pagination token never becomes part of a browser/product response contract.

A zero-result SearchComplete response is treated as one completed provider request with no continuation calls. SF does not silently return a partial result if provider metadata claims pages that cannot be retrieved within the documented pagination boundary.

## Required Travelport headers

For Stays API calls the adapter sends the current documented headers, including:

- `Accept-Encoding: gzip, deflate`;
- `Cache-Control: no-cache`;
- `Accept: application/json`;
- `Content-Type: application/json`;
- `Authorization: Bearer <token>`;
- `XAUTH_TRAVELPORT_ACCESSGROUP`;
- `E2ETrackingID` generated by SF;
- provisioned username, password, client ID, and client secret headers.

Because several required headers contain credentials, the adapter never reflects request headers, provider request bodies, provider response bodies, tokens, pagination tokens, or raw transport exceptions into product errors or structured request logs.

## Failure contract

Provider failures are normalized to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INVALID_REQUEST`, or `INVALID_RESPONSE`. Only rate-limit, provider-unavailable, and timeout failures are declared retryable. The adapter fails closed when:

- configuration is malformed;
- input date/guest/radius bounds are invalid;
- pagination token/page bounds are invalid;
- authentication returns an invalid token response;
- provider search returns a malformed or oversized page;
- a continuation response identifies the wrong page;
- a property lacks the minimum name/property identity fields;
- the provider returns an unexpected HTTP success/error shape.

Raw Travelport error text is not authority and is not exposed through the normalized error.

## Management and observability

`POST /api/integrations/travelport-stays` configures or rotates the tenant-owned integration. `POST /api/integrations/travelport-stays/test` authenticates with Travelport and records the normalized health result using the existing credential-version race check. Both routes:

- require same-origin form requests and an authenticated active organization;
- rely on server-side `integration:manage` authorization;
- attach organization ID to structured request logs only after active-tenant authority is established;
- log only static provider label `travelport-stays` plus existing bounded request correlation metadata;
- never log form bodies, URLs/query strings, credentials, token values, access groups, provider payloads, or raw errors.

The generic Integration enable/disable/archive route remains provider-neutral and continues to enforce tenant ownership. Supplier search itself remains a server service with no customer-facing external-supplier route or reserve action yet; it does not log the search criteria, supplier property references, provider pagination token, or returned property data.

## Validation boundary

The pure provider adapter has dependency-free tests for configuration, fixed endpoints, documented token fields, health failure classification, timeout handling, SearchComplete request/header construction, token reuse, normalized projection, invalid input, malformed/oversized provider pages, pagination endpoint construction, pagination bounds, and page-number integrity.

The pure complete-search collector has tests for multi-page completion, zero-result handling, duplicate-property rejection, missing pagination authority, unsupported page counts, and inconsistent continuation metadata. A dependency-free source contract verifies that tenant `availability:read` authorization happens before active provider credentials are loaded. Supplier tests are included in the repository's default `npm test` command.

A live Travelport API call is not part of repository validation because no provider credentials are committed. Production/pre-production credential testing is an explicit administrator action after real Travelport provisioning.

Database-backed tenant isolation, encrypted credential persistence, credential-version audit behavior and archive destruction continue to rely on the existing integration persistence boundary and its disposable-PostgreSQL suite.

## Remaining work before customer-facing supplier booking

1. Define normalized exact-money/rate/offer authority and expiry rules; then advertise `availability`/`pricing` only when those adapters exist.
2. Connect those authoritative supplier offers to a real product/UI search surface only when prices, restrictions, loading/error/empty states, and browser-safe failure presentation are complete. The current server search service intentionally exposes no customer route.
3. Implement reservation creation only after the booking offer/reference contract can be revalidated and the write has exact tenant-scoped idempotency and ambiguity recovery.
4. Add provider-supported retrieve/modify/cancel only after each capability is independently verified against current Travelport documentation and real access.
5. Add live integration tests against a specifically provisioned Travelport non-production account without storing credentials in source control.
