# GDS and external supplier integration

## Status

Travelport TripServices Stays is SF's selected first external hospitality supplier. The repository now contains tenant-owned encrypted Travelport configuration, explicit connection testing, complete bounded SearchComplete property pagination, a tenant-authorized property search service, exact-money provider offer normalization, and mandatory no-cache offer revalidation. No external-supplier reservation write or customer-facing booking workflow is exposed yet.

Provider selection and the currently implemented Travelport contract were reviewed against public Travelport documentation on 2026-09-06.

## Current SF boundary

Provider-specific behavior remains under `src/server/suppliers/` and `src/server/integrations/`. The normalized boundary currently supports:

- bounded city/date/occupancy property discovery;
- SearchComplete continuation pages 2-5 with the opaque provider page token kept server-side;
- opaque SF supplier property references carrying the provider chain/property identity needed for exact-property follow-up;
- exact-property SearchComplete pricing using requested currency and Travelport's provider-specific `TVP-Cache-Control: no-cache` mode;
- exact integer-minor money for base/tax/total/fees and bounded normalized rate terms/inclusions;
- deterministic normalized offer fingerprints so same-price commercial changes are detectable;
- explicit revalidation results: unchanged, price changed, other commercial change, or unavailable;
- no trusted offer TTL (`validUntil: null`) and mandatory revalidation before any future reservation action;
- an explicit `rulesRequiredBeforeReservation` boundary because provider Rules evidence is not yet implemented;
- `availability:read` before property discovery and `availability:read` + `pricing:read` before offer pricing/revalidation, all before encrypted credentials are loaded;
- normalized provider failures with no raw provider payload/error leakage.

Travelport integrations now advertise only `availability`, `hotel-search`, and `pricing`. A checked-in data migration aligns current active/disabled Travelport records while preserving archived capability history.

## Why reservation remains closed

Travelport documents that SearchComplete can continue into the v11 booking workflow and that v11 Rules may be used to retrieve rules for a rate. Travelport also documents `TVP-Cache-Control: no-cache` for real-time pricing and explicitly recommends a final price check before booking. SF therefore treats SearchComplete offers as observed commercial data, never as a durable promise.

The next dependency is a normalized v11 Rules contract tied to the selected property/rate identity. After that, reservation writes still require tenant-scoped durable idempotency, persisted supplier references, ambiguous-outcome recovery, retry rules, and provider-truth retrieval before SF can expose a reserve action.

## Validation boundary

Dependency-free supplier tests cover property discovery/pagination, token behavior, exact offer normalization, cache-control behavior, money precision/currency failures, commercial fingerprinting, and revalidation outcomes. Source-contract coverage checks authorization-before-credential-load ordering and ensures reservation code has not been introduced through this read-side slice.

Live Travelport validation remains blocked until a provisioned non-production account is available. Full Prisma migration/drift and PostgreSQL integration checks require the explicitly disposable database target. No credentials belong in source control or repository automation.

## References

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelFAQ.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/HotelAPIReferences.htm
