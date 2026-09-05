# GDS and external supplier integration

## Status

Travelport TripServices Stays is SF's selected first external hospitality supplier. The repository contains tenant-owned encrypted Travelport configuration, explicit connection testing, complete bounded SearchComplete property pagination, tenant-authorized property/offer services, exact-money offer normalization, mandatory no-cache offer revalidation, normalized v11 Rules evidence, a provider-neutral durable reservation-operation ledger, and a server-only known-locator Hotel reservation recovery adapter. No Travelport reservation create call or customer/staff reserve action is exposed yet.

Provider selection and the implemented Travelport contract were reviewed against public Travelport documentation on 2026-09-06.

## Current SF boundary

Provider-specific behavior remains under `src/server/suppliers/` and `src/server/integrations/`. The normalized boundary currently supports:

- bounded city/date/occupancy property discovery and SearchComplete continuation pages 2-5;
- opaque SF property/offer references while provider pagination/booking identifiers stay adapter-owned;
- exact-property no-cache pricing and exact integer-minor money;
- deterministic offer fingerprints and mandatory revalidation with no trusted offer TTL;
- normalized v11 Rules evidence plus deterministic terms fingerprint and final no-cache offer revalidation;
- `availability:read` before discovery and `availability:read` + `pricing:read` before pricing/revalidation/Rules, all before credentials are loaded;
- normalized provider failures without raw provider payload/error leakage;
- tenant-owned reservation operation/attempt persistence with exact idempotency, credential-version binding, serializable claims, and fail-closed ambiguity state;
- provider-neutral known-locator reservation recovery backed by Travelport Hotel `GET book/reservations/{AggregatorLocatorCode}`, with exact Travelport locator verification and explicit 404-to-`NOT_FOUND` handling.

Travelport integrations still advertise only `availability`, `hotel-search`, and `pricing`. Rules, the operation ledger, and known-locator recovery are pre-reservation infrastructure, not a live reservation capability. The ledger create/reconcile claim boundary still requires `reservation`, so current configuration cannot enter an unimplemented provider write.

## Why reservation creation remains closed

Fresh Travelport documentation exposed an important create-path constraint: the Create Reservation reference payload documents SearchComplete booking authority specifically from `propertyItems/lowestPublicAvailableRate/rateKey/value`. SF supports selecting normalized room/rate offers, not just the property's lowest public rate. SF therefore does not treat an arbitrary selected room-rate key as a valid `CatalogOfferingIdentifier` and contains no reservation POST based on that assumption.

The next create implementation must establish a documented exact-offer bridge (for example, a separately verified Availability/full-payload path) or prove the necessary SearchComplete reference semantics with provisioned Travelport non-production credentials. The initial create must never send `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`; Travelport documents those as explicit second-request decisions after a price/guarantee change prevents the first booking.

Known-locator recovery is now implemented, but it cannot solve a create that disconnects before SF receives the aggregator locator. Hotel Retrieve requires that locator. Locator-less uncertain writes must remain `AMBIGUOUS` until a verified provider lookup/correlation mechanism exists; they may not be converted to `NOT_FOUND` or retried blindly.

## Validation boundary

Dependency-free/source-level checks cover property discovery/pagination, authorization-before-credential-load ordering, exact offer normalization, no-cache revalidation, Rules, provider isolation, reservation-operation idempotency/state/privacy, the known-locator recovery contract, and continued absence of a Travelport reservation POST. Focused recovery adapter tests cover success, 404, locator mismatch, retryable provider failures, auth token eviction, and unsafe locator rejection.

Live Travelport validation remains blocked until a provisioned non-production account is available. Full Node 24/Prisma/PostgreSQL execution requires the repository's supported toolchain and an explicitly disposable database target. No credentials belong in source control or repository automation.

See `docs/travelport-stays-integration.md` and `docs/supplier-reservation-operations.md`.

## References

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
