# GDS and external supplier integration

## Status

Travelport TripServices Stays is the selected first external hospitality supplier for SF. The repository contains a real Travelport Stays adapter, tenant-owned encrypted configuration, authenticated connection testing, complete normalized SearchComplete pagination, and a tenant-authorized server-side hotel-search service. No customer-facing external-supplier booking workflow is exposed yet, and no unsupported Travelport pricing/reservation/modification/cancellation capability is presented as implemented.

## Why Travelport Stays is first

Travelport is a strong match for SF's existing hospitality inventory and booking domain, and its current public TripServices Stays documentation provides a concrete hotel workflow plus obtainable trial/customer provisioning. The current API contract is REST/JSON and exposes SearchComplete, availability/rules, reservation creation, retrieval, modification, and cancellation as separate provider capabilities, which allows SF to add each capability only when its adapter contract is production-ready.

Provider selection was reviewed against current public documentation on 2026-09-06. The initial SF adapter deliberately starts with hotel search rather than importing Travelport's complete object model into core booking code.

## Verified Travelport contract

- OAuth 2.0 authentication endpoint: pre-production `https://auth.pp.travelport.net/oauth/token`, production `https://auth.travelport.net/oauth/token`.
- The documented token request uses `grant_type=password`, `username`, `password`, `client_id`, and `client_secret`. Travelport documents a 24-hour token lifetime and requires token caching/reuse rather than requesting a token for every API call.
- Stays v12 SearchComplete endpoint: `POST search/searchcomplete` under pre-production `https://api.pp.travelport.net/12/hotel/` or production `https://api.travelport.net/12/hotel/`.
- SearchComplete returns up to 100 properties on page 1. Additional pages use `GET search/searchcomplete/{SearchIdentifier}?pageNumber={x}`, where the identifier is the opaque SearchComplete pagination token. Travelport documents page numbers 2 through 5, no request payload, and a 30-minute paging-identifier lifetime.
- Common Stays headers include the bearer token, `XAUTH_TRAVELPORT_ACCESSGROUP`, and the provisioned username/password/client credentials. SF therefore treats the complete Travelport credential set and access group as server-only integration credentials.
- SearchComplete can proceed to the v11 booking workflow, but SF does not advertise or call reservation capability until pricing/offer authority and reservation lifecycle are separately implemented and validated.

## Current SF boundary

The provider-neutral contract lives under `src/server/suppliers/`. The Travelport adapter and supplier-search service:

- accept a bounded city-IATA/date/room/guest search input;
- choose fixed Travelport URLs from a validated `pre-production` or `production` enum, so callers cannot supply arbitrary provider URLs;
- cache access tokens by tenant integration + credential version with duplicate refresh suppression;
- send an SF-generated Travelport tracking ID for provider-side correlation;
- map provider transport/authentication/rate-limit failures to bounded provider-neutral failure codes;
- reject malformed/oversized provider responses instead of passing provider JSON through the application;
- retrieve the complete documented SearchComplete result set through at most five bounded pages and never expose the opaque provider page token to product callers;
- reject page-number mismatches, total-count drift, duplicate supplier property references, missing pagination authority, and result sets outside the documented page boundary;
- return only normalized property reference, name, property type, availability, total result count, and page-count evidence;
- require `availability:read` before active tenant credentials are loaded for operational supplier search;
- advertise only `hotel-search` in the Integration capability set.

Tenant administrators can configure, rotate, test, disable, and archive Travelport Stays through the existing `/integrations` authority boundary. Credentials are encrypted using the existing integration envelope, never read back into the browser, and permanently purged on archive. Connection-test audit/log records contain normalized status/version/provider context only, not credentials, token values, request bodies, provider payloads, pagination tokens, or Travelport property data.

## Remaining Phase 15 work

The next dependency is normalized exact-money/rate/offer authority and expiry/revalidation semantics. Only after that contract exists should SF expose a customer/staff product search surface that presents provider pricing or allow a reserve action. External reservation writes must add exact tenant-scoped idempotency, retry/ambiguity recovery, durable supplier references, and provider-truth retrieval before they can be production-authoritative.

Live integration validation still requires a specifically provisioned Travelport non-production account. No provider credentials belong in source control or automated repository workflows.

Do not add a generic supplier UI, fake hotel inventory, placeholder booking route, or mock Travelport success path while those dependencies remain incomplete.

## Current source references

- Travelport TripServices authentication: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/GeneralProject/Oauth.htm
- Travelport Common Stays API Headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- Travelport SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- Travelport SearchComplete Pagination API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
