# GDS and external supplier integration

## Status

Travelport TripServices Stays is the selected first external hospitality supplier for SF. The repository now contains a real Travelport Stays adapter foundation, tenant-owned encrypted configuration, an authenticated connection test, and a normalized hotel-search contract. No customer-facing external-supplier booking workflow is exposed yet, and no unsupported Travelport pricing/reservation/modification/cancellation capability is presented as implemented.

## Why Travelport Stays is first

Travelport is a strong match for SF's existing hospitality inventory and booking domain, and its current public TripServices Stays documentation provides a concrete hotel workflow plus obtainable trial/customer provisioning. The current API contract is REST/JSON and exposes SearchComplete, availability/rules, reservation creation, retrieval, modification, and cancellation as separate provider capabilities, which allows SF to add each capability only when its adapter contract is production-ready.

Provider selection was reviewed against current public documentation on 2026-09-06. The initial SF adapter deliberately starts with hotel search rather than importing Travelport's complete object model into core booking code.

## Verified Travelport contract

- OAuth 2.0 authentication endpoint: pre-production `https://auth.pp.travelport.net/oauth/token`, production `https://auth.travelport.net/oauth/token`.
- The documented token request uses `grant_type=password`, `username`, `password`, `client_id`, and `client_secret`. Travelport documents a 24-hour token lifetime and explicitly requires token caching/reuse rather than requesting a token for every API call.
- Stays v12 SearchComplete endpoint: `POST search/searchcomplete` under pre-production `https://api.pp.travelport.net/12/hotel/` or production `https://api.travelport.net/12/hotel/`.
- Common Stays headers include the bearer token, `XAUTH_TRAVELPORT_ACCESSGROUP`, and the provisioned username/password/client credentials. SF therefore treats the complete Travelport credential set and access group as server-only integration credentials.
- SearchComplete returns at most 100 properties in a page and can return a pagination token. SF's normalized result preserves only bounded page metadata and an opaque next-page token; no unbounded provider collection is loaded.
- SearchComplete can proceed to the v11 booking workflow, but SF does not advertise or call reservation capability until pricing/offer authority and reservation lifecycle are separately implemented and validated.

## Current SF boundary

The provider-neutral contract lives under `src/server/suppliers/`. The Travelport adapter:

- accepts a bounded city-IATA/date/room/guest search input;
- chooses fixed Travelport URLs from a validated `pre-production` or `production` enum, so callers cannot supply arbitrary provider URLs;
- caches access tokens by tenant integration + credential version with duplicate refresh suppression;
- sends an SF-generated Travelport tracking ID for provider-side correlation;
- maps provider transport/authentication/rate-limit failures to bounded provider-neutral failure codes;
- rejects malformed/oversized provider responses instead of passing provider JSON through the application;
- returns only normalized property reference, name, property type, availability, and bounded pagination metadata;
- advertises only `hotel-search` in the Integration capability set.

Tenant administrators can configure, rotate, test, disable, and archive Travelport Stays through the existing `/integrations` authority boundary. Credentials are encrypted using the existing integration envelope, never read back into the browser, and permanently purged on archive. Connection-test audit/log records contain normalized status/version/provider context only, not credentials, token values, request bodies, provider payloads, or Travelport property data.

## Remaining Phase 15 work

The next dependency is to connect normalized supplier search to an authenticated/product search service without bypassing tenant authority, then add provider-specific SearchComplete pagination retrieval, normalized price/offer authority, and only afterward reservation lifecycle methods that can be proven against real Travelport capabilities and credentials. External reservation writes must add exact idempotency, retry/ambiguity handling, and durable supplier references before any customer-facing reserve action is opened.

Do not add a generic supplier UI, fake hotel inventory, placeholder booking route, or mock Travelport success path while those dependencies remain incomplete.

## Current source references

- Travelport TripServices authentication: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/GeneralProject/Oauth.htm
- Travelport Common Stays API Headers: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/CommonHotelAPIHeaders.htm
- Travelport SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
