# GDS and external supplier integration

## Status

Travelport TripServices Stays is SF's selected first external hospitality supplier. The repository contains tenant-owned encrypted Travelport configuration, explicit connection testing, complete bounded SearchComplete property pagination, tenant-authorized property/offer services, exact-money provider offer normalization, mandatory no-cache offer revalidation, and normalized v11 Rules evidence. No external-supplier reservation write or customer-facing booking workflow is exposed yet.

Provider selection and the currently implemented Travelport contract were reviewed against public Travelport documentation on 2026-09-06.

## Current SF boundary

Provider-specific behavior remains under `src/server/suppliers/` and `src/server/integrations/`. The normalized boundary currently supports:

- bounded city/date/occupancy property discovery;
- SearchComplete continuation pages 2-5 with the opaque provider page token kept server-side;
- opaque SF supplier property/offer references carrying only the provider identities required for adapter follow-up;
- exact-property SearchComplete pricing using requested currency and Travelport's provider-specific `TVP-Cache-Control: no-cache` mode;
- exact integer-minor money for base/tax/total/fees and bounded normalized SearchComplete terms/inclusions;
- deterministic normalized offer fingerprints so same-price commercial changes are detectable;
- explicit offer revalidation results: unchanged, price changed, other commercial change, or unavailable;
- no trusted offer TTL (`validUntil: null`) and mandatory revalidation;
- a provider-neutral booking-terms contract backed by Travelport v11 full-payload Rules;
- an adapter-internal no-cache SearchComplete bridge that obtains `bookingCode` / rate-code data without exposing provider fields to product code;
- exact normalized Rules price, guarantee, cancellation, deposit, payment-card, check-in/out, and bounded text evidence plus a deterministic terms fingerprint;
- a final no-cache offer revalidation after Rules; rule evidence is discarded when the selected offer changed while rules were fetched;
- `availability:read` before property discovery and `availability:read` + `pricing:read` before pricing/revalidation/Rules, all before encrypted credentials are loaded;
- normalized provider failures with no raw provider payload/error leakage.

Travelport integrations advertise only `availability`, `hotel-search`, and `pricing`. Rules review is pre-reservation pricing/commercial evidence, not a reservation capability. A checked-in data migration aligns current active/disabled Travelport records while preserving archived capability history.

## Why reservation remains closed

SearchComplete is a v12 observation while Travelport's downstream Rules and reservation workflow is v11. SF now bridges the selected rate into the documented full-payload Rules call, but deliberately supports only one-room Rules review and one to nine guests until a wider room-candidate contract is verified. Unsupported shapes fail before provider transport rather than being guessed.

Rules evidence does not create a reservation and remains subject to final provider truth. Travelport's reservation APIs independently detect price and guarantee changes before creating a booking and require explicit acceptance flags on a subsequent attempt. SF will not silently opt into those changes.

The next dependency is durable tenant-scoped supplier reservation persistence: exact external-write idempotency, ambiguous-outcome recovery, persisted supplier references, retry/reconciliation rules, and provider-truth retrieval. Only after that boundary is complete can a real reserve action be exposed.

## Validation boundary

Dependency-free/source-level checks cover property discovery/pagination, authorization-before-credential-load ordering, exact offer normalization, cache-control/revalidation behavior, the v11 Rules endpoint, final revalidation, provider isolation, and the absence of reservation or automatic price/guarantee acceptance code. Focused supplier tests cover Rules normalization and fail-closed unsupported request/response shapes.

Live Travelport validation remains blocked until a provisioned non-production account is available. Full Prisma migration/drift and PostgreSQL integration checks require the explicitly disposable database target. No credentials belong in source control or repository automation.

## References

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
