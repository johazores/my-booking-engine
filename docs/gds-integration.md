# GDS and external supplier integration

## Status

Travelport TripServices Stays is SF's selected first external hospitality supplier. The repository contains tenant-owned encrypted Travelport configuration, explicit connection testing, complete bounded SearchComplete property pagination, tenant-authorized property/offer services, exact-money offer normalization, mandatory no-cache offer revalidation, normalized v11 Rules evidence, a provider-neutral durable reservation-operation ledger, a server-only known-locator Hotel reservation recovery adapter, and a read-only SearchComplete-to-Availability selected-offer authority bridge. No Travelport reservation create call or customer/staff reserve action is exposed yet.

Provider selection and the implemented Travelport contract were reviewed against current public Travelport documentation on 2026-09-06.

## Current SF boundary

Provider-specific behavior remains under `src/server/suppliers/` and `src/server/integrations/`. The normalized boundary currently supports:

- bounded city/date/occupancy property discovery and SearchComplete continuation pages 2-5;
- opaque SF property/offer references while provider pagination/booking identifiers stay adapter-owned;
- exact-property no-cache pricing and exact integer-minor money;
- deterministic offer fingerprints and mandatory revalidation with no trusted offer TTL;
- normalized v11 Rules evidence plus deterministic terms fingerprint and final no-cache offer revalidation;
- read-only exact selected-offer authority verification by remapping fresh SearchComplete `bookingCode`/rate evidence through complete bounded v11 Availability results;
- `availability:read` before discovery, `availability:read` + `pricing:read` before pricing/revalidation/Rules, and those read permissions plus `booking:manage` before reservation-authority review, all before credentials are loaded;
- normalized provider failures without raw provider payload/error leakage;
- tenant-owned reservation operation/attempt persistence with exact idempotency, credential-version binding, serializable claims, and fail-closed ambiguity state;
- provider-neutral known-locator reservation recovery backed by Travelport Hotel `GET book/reservations/{AggregatorLocatorCode}`, with exact Travelport locator verification and fail-closed negative evidence.

Travelport's public Retrieve reference documents the GET endpoint and successful reservation response shape, but it does not establish HTTP 404 as authoritative proof that the exact reservation does not exist. A generic HTTP 404 is not authoritative negative evidence in SF. The adapter therefore treats it as `INVALID_RESPONSE`, which the coordinator settles back to `AMBIGUOUS`; it does not convert that response into provider-neutral `NOT_FOUND` or make another create retryable. `NOT_FOUND` remains available in the provider-neutral recovery contract only for a provider adapter with verified authoritative negative lookup semantics.

Travelport integrations still advertise only `availability`, `hotel-search`, and `pricing`. Rules, Availability authority review, the operation ledger, and known-locator recovery are pre-reservation infrastructure, not a live reservation capability. The ledger create/reconcile claim boundary still requires `reservation`, so current configuration cannot enter an unimplemented provider write.

## Selected-offer create authority

Travelport's SearchComplete reference-create documentation identifies the reference booking value specifically from `propertyItems/lowestPublicAvailableRate/rateKey/value`, while SF supports selecting normalized room/rate offers beyond only that lowest public rate. SF therefore does not treat an arbitrary selected SearchComplete rate key as a valid `CatalogOfferingIdentifier`.

The new read-only authority adapter instead repeats fresh Rules/offer review, recovers the selected SearchComplete rate's `bookingCode` and optional rate-code evidence, and queries v11 Availability for the same aggregator, property, dates, occupancy, and rate filters. It consumes all documented Availability pages 1-5 and accepts authority only when exactly one Availability offer maps back to that selected rate. Expiring Availability identifiers stay adapter-owned; the product receives only a deterministic authority fingerprint. A future write coordinator must repeat this bridge immediately before create.

Travelport documents `requestedCurrency` on Availability as a conversion-rate request rather than a conversion of response amounts, so Availability money is not treated as accepted SF commercial truth. Fresh SearchComplete + Rules evidence remains the exact-money authority.

## Why reservation creation remains closed

The current Travelport v11 Create Reservation contracts require traveler data plus form-of-payment and payment details. The documented card payload uses `PaymentCard/CardNumber/PlainText`, and some suppliers require `SeriesCode/PlainText`; Booking.com requires CVV. SF's existing online-payment boundary intentionally never accepts raw card data. A PCI-safe Travelport form-of-payment/guarantee strategy must therefore be established and validated with the provisioned account before a real supplier POST is added.

The initial create must also never send `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`; Travelport documents those as explicit second-request decisions only after a price/guarantee change prevents the first booking.

Known-locator recovery can confirm an exact reservation when Retrieve returns matching reservation evidence, but it still cannot establish safe retry from a generic HTTP 404, and it cannot solve a create that disconnects before SF receives the aggregator locator. Hotel Retrieve requires that locator. Known-locator negative evidence and locator-less uncertain writes must remain `AMBIGUOUS` until a verified provider lookup/correlation mechanism exists; they may not be converted to `NOT_FOUND` or retried blindly.

## Validation boundary

Dependency-free/source-level checks cover property discovery/pagination, authorization-before-credential-load ordering, exact offer normalization, no-cache revalidation, Rules, selected-offer Availability mapping/pagination, provider isolation, reservation-operation idempotency/state/privacy, the known-locator recovery contract, fail-closed generic HTTP 404 handling, and continued absence of a Travelport reservation POST. Focused adapter tests cover the authority success/rejection paths and the recovery success, generic 404 rejection, locator mismatch, retryable provider failures, auth token eviction, and unsafe locator rejection.

Live Travelport validation remains blocked until a provisioned non-production account is available. Full Node 24/Prisma/PostgreSQL execution requires the repository's supported toolchain and an explicitly disposable database target. No credentials belong in source control or repository automation.

See `docs/travelport-stays-integration.md` and `docs/supplier-reservation-operations.md`.

## References

- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_AvailPagination.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
- https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
