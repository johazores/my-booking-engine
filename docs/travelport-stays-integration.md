# Travelport Stays integration

## Purpose

This document defines SF's first production external hospitality supplier boundary. The implemented read-side boundary covers complete normalized hotel discovery, exact-money SearchComplete offer pricing, mandatory fresh offer revalidation, normalized Travelport v11 Rules evidence, a read-only Availability authority bridge for the exact selected offer, credential authentication, and connection health verification. SF also has a provider-neutral durable reservation-operation ledger and a server-only Travelport known-locator reservation recovery adapter. No Travelport reservation create call, modification/cancellation call, or customer/staff reserve action is exposed yet.

## Provider identity and tenant ownership

SF uses provider code `travelport-stays`. Each configured record is owned by exactly one organization through the existing `Integration` model and is managed through `integration:manage`. The browser cannot submit an organization ID or capability list.

The server currently derives the implemented Travelport capability list as `availability`, `hotel-search`, and `pricing`. `reservation`, `modification`, `cancellation`, `refund`, `ticketing`, and flight capabilities are not advertised.

Operational supplier reads use product permissions rather than integration-administration permissions. Property discovery requires tenant-scoped `availability:read`. Offer pricing, revalidation, and booking-rule review require both `availability:read` and `pricing:read`. The reservation-authority review additionally requires `booking:manage`. All permission checks complete before the active encrypted Travelport integration is loaded, so credential access never substitutes for product authorization.

The provider-neutral reservation-operation persistence service requires server-side `booking:manage`, but its create/reconciliation claims additionally require the selected integration to advertise `reservation`. Current Travelport configuration intentionally does not advertise that capability, so neither the operation ledger nor the new read-only authority review can accidentally become an unimplemented provider write path.

## Credentials and token lifecycle

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the existing encrypted integration credential envelope. Provider endpoints are fixed constants selected from the validated environment; callers cannot supply arbitrary URLs.

Travelport documents reusable TripServices access tokens. SF keys in-process adapter token caches by Integration ID plus credential version, suppresses duplicate concurrent refreshes within each adapter, refreshes before expiry, and evicts a cached token after provider authentication rejection. Rotation therefore changes token authority automatically. Token values and credential headers are never returned, audited, logged, or persisted outside the encrypted credential envelope.

## Property discovery and pagination

`HospitalitySupplierProvider` owns the provider-neutral property-search contract. Search input is bounded to city IATA code, local stay dates, room/adult counts, optional child ages, and radius. Travelport v12 SearchComplete is called with `returnOnlyAvailableProperties: true` and responses are rebuilt into SF-owned property records.

SearchComplete page 1 can return up to 100 properties. SF consumes the documented continuation pages 2 through 5 with the opaque SearchIdentifier, limits the complete collection to five pages / 500 properties, requires stable totals, rejects duplicate property references and page mismatches, and never returns the provider pagination token from the complete product result.

## Exact offer pricing and revalidation

`HospitalitySupplierPricingProvider` extends the normalized supplier contract with exact-property offer search and revalidation. Pricing requests use `TVP-Cache-Control: no-cache`. SF does not assign a trusted offer TTL: normalized results use `validUntil: null`, `providerCacheMode: NO_CACHE`, and `revalidationRequired: true`.

Provider decimal amounts are converted through SF's shared currency/minor-unit money boundary. Rates fail closed for malformed or mixed currency, invalid precision, absent mandatory totals, bounded-structure violations, and duplicate provider rate identities. Each normalized offer includes opaque property/offer references, exact integer-minor money, bounded terms/inclusions, and a deterministic SHA-256 `offerFingerprint`.

`revalidatePropertyOffer` performs another no-cache exact-property SearchComplete request and returns `UNCHANGED`, `PRICE_CHANGED`, `OFFER_CHANGED`, or `UNAVAILABLE`. A fresh observation is not a durable reservation guarantee.

## Pre-reservation Rules authority

`HospitalitySupplierBookingTermsProvider` is the provider-neutral rule-evidence boundary. The Travelport implementation uses v11 full-payload Rules `rules/offershospitality/buildfromrequest`. An adapter-internal no-cache SearchComplete bridge matches the selected rate and obtains the `bookingCode` and optional rate-code details needed by Rules without exposing those provider fields to product code.

The current Rules boundary supports one room and one to nine guests. Rules responses are normalized into exact money, payment timing and recognized guarantee types, loyalty/check-in qualification requirements, structured cancellation penalties, deposits, accepted card codes, check-in/out times, bounded text, a deterministic `termsFingerprint`, and `completeForReservationReview`. Unsupported guarantee or penalty semantics fail closed.

Successful Rules evidence is discarded unless a final no-cache offer revalidation remains `UNCHANGED`. Rules evidence does not authorize or create a reservation, and SF never silently accepts a provider price or guarantee change.

## Availability authority bridge

`HospitalitySupplierReservationAuthorityProvider` is a provider-neutral, read-only proof boundary for the selected external offer. The Travelport adapter first repeats the existing Rules/final-revalidation flow and requires the caller's accepted `offerFingerprint` and `termsFingerprint` to remain current and complete. It then performs another no-cache exact-property SearchComplete bridge to recover the selected rate's `bookingCode` and optional rate-code evidence.

The adapter sends a v11 Availability request for the exact property, dates, one-room occupancy, selected aggregator, and available rate-code filters. `verboseResponseInd: true` keeps property/date identity beside each product so SF can verify it directly. The adapter consumes every documented Availability continuation page 2 through 5, caps the result at five pages / 500 offers, requires stable totals, rejects duplicate offer identifiers, and fails closed unless exactly one Availability offer maps to the selected aggregator + `bookingCode` + property + dates, with any returned rate-code evidence consistent with the SearchComplete bridge.

Travelport documents that `requestedCurrency` on Availability does not convert response amounts. SF therefore does not reinterpret Availability money as the accepted commercial total. Exact money remains governed by the fresh SearchComplete + Rules evidence that was already verified before Availability authority is accepted.

A successful result returns a deterministic SHA-256 `authorityFingerprint` over the provider, property, selected SearchComplete rate identity, Availability booking identity, stay/occupancy, exact accepted money, and accepted offer/terms fingerprints. The expiring Availability pagination/offer identifiers remain adapter-owned and are not exposed as durable product authority. Any future create executor must repeat this authority bridge immediately before the write rather than treating a previous review as a timeless sell token.

This bridge establishes a safe route for arbitrary selected SF room/rate offers without assuming the SearchComplete `lowestPublicAvailableRate` reference-booking rule applies to every normalized rate. It still does not create a reservation and does not advertise `reservation`.

## Durable external-write operation ledger

`HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` provide the provider-neutral persistence/recovery substrate required before any supplier create call is allowed. An operation is tenant-owned, integration/credential-version bound, organization-idempotent, and fingerprinted over the accepted provider/property/offer authority, accepted offer/Rules evidence, exact money/stay/occupancy, and a required reservation-payload fingerprint. Raw traveler PII, card data, CVV, provider tokens, or future request bodies do not belong in this ledger.

Create/reconciliation claims use `booking:manage`, tenant-scoped integration ownership, serializable transactions, advisory locks, and a fresh check that provider code, credential version, active status, and `reservation` capability still match the reviewed request. Ambiguous creates may not be retried blindly; they must enter reconciliation first.

This ledger remains separate from first-party `HospitalityBooking`; external inventory does not fabricate local property, room, rate, hold, or allocation identifiers. See `docs/supplier-reservation-operations.md`.

## Known-locator reservation recovery

`HospitalitySupplierReservationRecoveryProvider` is the provider-neutral read-only recovery contract. `TravelportStaysReservationRecoveryProvider` implements the documented Hotel Retrieve endpoint `GET book/reservations/{AggregatorLocatorCode}` using the same tenant-owned decrypted credentials and credential-version cache authority as the loaded Travelport integration.

The adapter accepts only a bounded single-line known Travelport aggregator locator. It returns `FOUND` only when the response contains exactly one `Receipt/Confirmation/Locator` with `sourceContext=Travelport` that exactly matches the requested locator. A single supplier confirmation may be retained as normalized recovery evidence. Multiple supplier locators or a mismatched/missing Travelport locator fail closed. An explicit retrieve HTTP 404 becomes `NOT_FOUND`; authentication, rate-limit, timeout, provider-unavailable, and malformed-response failures remain normalized provider failures.

This recovery adapter is deliberately read-only. It does not persist reservation state, audit raw provider data, log provider payloads, advertise `reservation`, or create a provider booking. `loadTravelportStaysIntegration` makes it available server-side for a future ledger coordinator without making any browser or product write path live.

## Create-path payment and PCI boundary

The current public Travelport v11 Create Reservation full and reference payload contracts require traveler details plus `FormOfPayment` and `Payment`. The documented card form includes `PaymentCard/CardNumber/PlainText`; `SeriesCode/PlainText` is required for certain suppliers and Booking.com requires CVV.

SF's existing online-payment security contract intentionally never accepts raw card data. The Travelport create path therefore remains closed until SF has a reviewed PCI-safe form-of-payment/guarantee strategy that is supported by the provisioned Travelport account and does not casually route PAN/CVV through normal SF application surfaces, logs, persistence, or audits. The repository must not weaken its existing card boundary merely to make the supplier reservation POST reachable.

Travelport also documents that price/guarantee changes stop the initial create and must only be accepted by a second request with explicit `acceptPriceChangeInd` / `acceptGuaranteeChangeInd`. SF will not send either flag on an initial create or silently opt into those changes.

## Ambiguous-outcome recovery limit

Travelport Hotel Retrieve starts from an aggregator locator returned at booking. If a future create request times out or disconnects before SF receives that locator, the public Hotel Retrieve contract alone cannot prove provider truth for the locator-less write. Such an outcome must remain `AMBIGUOUS`; it must never be converted to `NOT_FOUND` or blindly retried. A live non-production/provider-support validation must establish a reliable provider-assisted lookup or other correlation mechanism before SF can claim fully automatic ambiguous-create recovery.

## Failure and privacy contract

Provider read failures normalize to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INVALID_REQUEST`, or `INVALID_RESPONSE`. Malformed provider data, unsafe identifiers, authority mismatches, mixed currency, unsupported Rules shapes, oversized/duplicate structures, incomplete pagination, and ambiguous Availability mappings fail closed.

Raw Travelport errors, credentials, tokens, access groups, request headers/bodies, response bodies, pagination tokens, rate keys, booking codes, Availability offer identifiers, property keys, traveler/customer data, payment/card material, and supplier commercial payloads are not copied into audits or structured request logs.

## Validation boundary

The supplier suite covers configuration/fixed endpoints, token behavior, health failure normalization, SearchComplete discovery/pagination, exact-money pricing, no-cache revalidation, Rules request/normalization/race handling, selected-offer Availability authority mapping/pagination, supplier reservation operation state/idempotency/privacy, and known-locator Travelport reservation recovery. A guarded PostgreSQL scenario remains checked in for tenant isolation, exact retry, ambiguity reconciliation, attempt ordering, confirmation, and credential-version invalidation.

Live provider validation still requires a provisioned Travelport non-production account. Full Prisma migration/drift/database execution requires an explicitly disposable PostgreSQL target. Neither is claimed by source-only validation.

## Remaining work before supplier reservation is live

1. Validate the SearchComplete-to-Availability selected-rate bridge, Availability create identifiers, and exact request/response shapes against provisioned Travelport non-production credentials.
2. Establish a reviewed PCI-safe form-of-payment/guarantee strategy for Travelport reservation creation without weakening SF's rule that normal product flows never accept raw card data.
3. Implement the real single-room Travelport create adapter and secure execution coordinator. It must repeat fresh Rules/offer/Availability authority, bind the accepted authority to the persisted request, reconstruct only authorized traveler/guarantee/payment material, claim the durable operation, and settle every write outcome through the ledger.
4. Validate price/guarantee-change errors, locator-less ambiguous-write recovery, and correlation semantics against Travelport non-production/provider support.
5. Advertise `reservation` only after the real write/recovery contract is validated. Only then expose a staff/customer reserve surface with complete loading, empty, error, accessibility, and responsive states.
6. Expand independently to verified multi-room and provider-supported modify/cancel semantics.

## Current Travelport references

- SearchComplete v12: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- SearchComplete pagination: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- Hotel Availability: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Hotel Availability pagination: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_AvailPagination.htm
- Hotel Rules full payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Create Reservation full payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
- Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
- Stays API endpoints: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/General/HotelEndpoints.htm
