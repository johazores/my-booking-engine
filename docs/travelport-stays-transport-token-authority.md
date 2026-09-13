# Travelport Stays transport-token authority

## Purpose

Travelport configuration credentials, OAuth bearer tokens and token-lifetime metadata, and SearchComplete pagination identifiers cross transport boundaries before provider data can become pricing or reservation authority. They are opaque machine values or transport metadata, not presentation text. SF therefore preserves their exact spelling and fails closed instead of silently trimming, coercing, flooring, or control-normalizing them.

This contract strengthens the active `availability`, `hotel-search`, and `pricing` integration and the existing reservation foundation. It does not advertise the Travelport `reservation` capability or relax any Phase 15 activation gate.

## Credential authority

The public Travelport adapter owns the normalization boundary for configured credentials before delegating to the compatibility core. `username`, `password`, `clientId`, `clientSecret`, and `accessGroup` must be:

- non-empty strings;
- within the existing field-specific length limits;
- free of ASCII controls `U+0000` through `U+001F` and `U+007F`; and
- already exact, with no leading or trailing whitespace that would change the submitted credential.

This keeps SF from saving or authenticating with a credential value different from the value the tenant actually supplied. Existing persisted Travelport credentials were already stored from the normalized public configuration flow; this change does not rewrite encrypted historical integration records.

The environment remains restricted to the fixed `pre-production` and `production` allowlist. Provider endpoints remain code-owned rather than tenant-controlled.

## OAuth token authority

Travelport's successful OAuth response is inspected at the public provider transport boundary before the compatibility parser can cache or use it. `access_token` must be a non-empty exact string, at most 16,384 characters, with no outer whitespace and no ASCII controls.

Travelport currently documents TripServices access-token validity as 24 hours / 86,400 seconds and requires callers to cache and reuse tokens until expiry. SF uses that documented lifetime as the maximum accepted explicit lifetime. When `expires_in` is present in a successful OAuth response, it must be either:

- a positive safe JSON integer from `1` through `86400`; or
- the exact canonical base-10 string spelling of such an integer.

Whitespace-padded strings, leading-zero aliases, exponent notation, decimal/fractional values, zero/negative values, non-finite or unsafe numbers, values above the documented 24-hour lifetime, and other types fail closed before the compatibility parser can coerce or floor them. When `expires_in` is omitted, the existing compatibility core retains the documented 86,400-second fallback. A shorter valid lifetime remains honored.

The guard applies to:

- direct `requestTravelportStaysAccessToken` callers;
- the integration health probe;
- the active SearchComplete/pricing provider;
- Rules retrieval; and
- the existing reservation Create, reviewed-Create, Sync, reservation-authority, and known-locator recovery implementations that import the public token helper.

Authentication failures and provider status handling remain unchanged. Token values and expiry response bodies are not logged, persisted as audit detail, or exposed to browser code by this boundary.

## SearchComplete pagination authority

Travelport documents SearchComplete pagination as an opaque `paginationToken` returned by SearchComplete and replayed in `search/searchcomplete/{SearchIdentifier}?pageNumber={x}`. Page numbers are documented as 2 through 5, with up to 100 properties per page. The current Stays guide says the token from the initial response is the value to send for each additional page.

SF validates pagination before the compatibility parser or follow-on request can normalize/replay it:

- a present `paginationToken` must be non-empty, exact, at most 4,096 characters, and free of the full ASCII control range;
- caller-supplied follow-on page tokens use the same exact rule before any OAuth or provider request is attempted;
- the canonical path token used for a continuation request is materialized as request authority before response validation;
- if a successful continuation response returns `pagination.paginationToken`, that present continuation response token must equal the exact token replayed in the request;
- omission remains accepted because current provider documentation establishes the request token but does not prove that every continuation response repeats it; the continuity check therefore does not make the token mandatory on continuation responses;
- `page`, `pageSize`, `totalPages`, and `totalItems` must be non-negative integers;
- page and total-page metadata cannot exceed five pages;
- page size cannot exceed 100; and
- total item metadata cannot exceed the bounded five-page / 500-item SearchComplete collection used by SF.

A changed present token is contradictory machine authority and fails as `INVALID_RESPONSE` before the compatibility result can expose it as `nextPageToken`. This preserves Travelport's documented single pagination identifier across the active result set without inventing evidence when a continuation response omits the field.

The provider-neutral complete-search collector still performs its independent cross-page checks: first-page shape, total-page/total-item continuity, duplicate property references, exact final item count, and no pagination-token exposure in its returned domain object.

## Similar-issue sweep

The same continuation-token concern exists in the v11 Availability reservation-authority path. That path already keeps state for the page-one Availability identifier, selected property/rate/stay authority, result-set geometry, origin, TTL, and bounded capacity. Its selection wrapper now also rejects a present continuation `CatalogOfferings.Identifier.value` when it differs from the active page-one token, while still allowing the field to be absent on continuation responses. Provider-specific token semantics remain in the Travelport adapters rather than being pushed into the provider-neutral search collector.

SearchComplete used by the deliberately disabled reservation-authority flow is intentionally page-one-only and therefore has no continuation state. Create, reviewed Create, Sync, and known-locator recovery use separate reservation correlation/reference contracts and are not changed by this pagination boundary.

## Compatibility-contract repair

The Travelport provider was previously split into a hardened public authority adapter and a `*-core.ts` compatibility implementation. Dependency-free contracts must therefore pin authority behavior at the public adapter while allowing the compatibility core to keep legacy parsing mechanics behind that guard.

The contract checks each responsibility at its actual boundary:

- public adapter: exact references, credentials, OAuth token and expiry authority, and pagination replay/response authority;
- provider core: fixed SearchComplete pagination endpoint, documented page-number bounds, page-result matching, pricing normalization, and no-cache revalidation behavior;
- Rules public adapter: hardened authority wrapping; and
- Rules core: provider request construction and fresh revalidation mechanics.

The explicit OAuth expiry guard is intentionally before the compatibility token parser. The core can continue accepting its historical number/string shape internally, but malformed or normalization-confusable provider values cannot reach that parser through the production public boundary.

## Validation

Focused regression coverage pins:

- padded and ASCII-control-bearing configuration credentials are rejected;
- padded and ASCII-control-bearing OAuth tokens cannot become bearer authority;
- OAuth `expires_in` cannot rely on whitespace trimming, leading-zero normalization, exponent/decimal coercion, fractional flooring, or an oversized lifetime;
- exact positive integer/string OAuth lifetimes up to 86,400 seconds remain accepted and omission preserves the documented fallback;
- the integration health probe does not report healthy when OAuth token authority is malformed;
- padded/control-bearing SearchComplete pagination tokens fail before compatibility parsing;
- provider pagination metadata outside the five-page / 500-item boundary fails closed;
- padded/control-bearing pagination replay identifiers fail before any provider request;
- a present SearchComplete continuation token that differs from the replayed request token fails closed; and
- omission of the continuation response token remains accepted while page/geometry authority is still enforced.

Dependency-free source contracts also pin the public/core responsibility split and both Travelport pagination-token continuity boundaries so future compatibility refactors do not silently invalidate the test suite.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Travelport references

- Authentication: https://developer.travelport.com/docs/getting-started/authentication
- Using the DevKits — OAuth token requirement: https://developer.travelport.com/resources/using-the-devkits
- SearchComplete Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- Availability Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_AvailPagination.htm
- Stays APIs Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm

## Related SF contracts

- `docs/travelport-stays-availability-selection-authority.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-stays-integration.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
