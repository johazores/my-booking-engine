# Travelport Stays integration

## Purpose

This document defines SF's first production external hospitality supplier boundary. The implemented read-side boundary covers complete normalized hotel discovery, exact-money SearchComplete pricing, mandatory fresh offer revalidation, normalized Travelport v11 Rules evidence, a read-only Availability authority bridge for the exact selected offer, credential authentication, connection health verification, and known-locator reservation recovery through the durable supplier-operation ledger.

No Travelport reservation create, modification, cancellation, refund, or customer/staff reserve action is exposed yet.

## Provider identity and tenant ownership

SF uses provider code `travelport-stays`. Each configured integration belongs to exactly one organization through `Integration` and is managed through `integration:manage`. The browser cannot choose an organization ID or provider capability list.

The server currently derives Travelport capabilities as `availability`, `hotel-search`, and `pricing`. `reservation`, `modification`, `cancellation`, `refund`, `ticketing`, and flight capabilities are not advertised.

Operational supplier reads use product permissions rather than integration-administration permission. Property discovery requires `availability:read`; offer pricing/revalidation and Rules require `availability:read` plus `pricing:read`; selected-offer reservation-authority review additionally requires `booking:manage`.

Supplier reservation ledger claims and known-locator reconciliation require server-side `booking:manage` and a currently active integration that still advertises `reservation` with the exact bound credential version. Because Travelport configuration does not yet advertise `reservation`, the write/recovery execution state machine remains closed in production configuration.

## Credentials and token lifecycle

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the existing encrypted integration credential envelope. Provider endpoints are fixed constants selected from the validated environment; callers cannot supply arbitrary URLs.

All Travelport OAuth and Stays HTTP requests use those fixed environment endpoints with redirect following disabled at the transport boundary via `redirect: 'manual'`. The shared fetch helpers apply this policy after spreading caller request options so it cannot be overridden. Any unexpected 3xx response is handled by the existing non-success status path as `INVALID_RESPONSE`; SF never replays credential-bearing OAuth bodies or provider credential headers to a redirect target.

Reusable access tokens are cached in-process by Integration ID plus credential version. Concurrent refreshes are suppressed, tokens refresh before expiry, and authentication rejection evicts the cached token. Token values and credential headers are never returned, audited, logged, or persisted outside the encrypted credential envelope.

## Property discovery and pagination

`HospitalitySupplierProvider` owns the provider-neutral search contract. Search input is bounded to city IATA code, local stay dates, room/adult counts, optional child ages, and radius. Travelport v12 SearchComplete runs with `returnOnlyAvailableProperties: true`; responses are rebuilt into SF-owned normalized records.

SearchComplete page 1 can return up to 100 properties. SF consumes documented continuation pages 2 through 5, caps the complete collection at 500 properties, requires stable totals, rejects duplicate property references/page mismatches, and never exposes provider pagination tokens to product callers.

## Exact offer pricing and revalidation

`HospitalitySupplierPricingProvider` extends the normalized contract with exact-property offer search and revalidation. Pricing requests use `TVP-Cache-Control: no-cache`. SF does not invent a trusted provider TTL: normalized offers use `validUntil: null`, `providerCacheMode: NO_CACHE`, and `revalidationRequired: true`.

Provider decimal amounts are converted through SF's shared integer-minor money boundary. Malformed/mixed currency, invalid precision, missing totals, duplicate rate identities, and bounded-structure violations fail closed. Each offer includes opaque supplier references, exact money, normalized terms/inclusions, and deterministic `offerFingerprint` evidence.

Fresh revalidation returns only `UNCHANGED`, `PRICE_CHANGED`, `OFFER_CHANGED`, or `UNAVAILABLE`. A fresh observation is not a timeless reservation guarantee.

## Pre-reservation Rules authority

`HospitalitySupplierBookingTermsProvider` is provider-neutral. Travelport uses v11 full-payload Rules plus an adapter-internal SearchComplete bridge to recover provider booking/rate evidence without leaking provider-specific fields into product code.

The current Rules boundary supports one room and one to nine guests. Responses normalize exact money, payment timing, recognized guarantee types, qualification requirements, cancellation penalties, deposits, accepted card codes, check-in/out times, bounded text, deterministic `termsFingerprint`, and `completeForReservationReview`. Unsupported semantics fail closed.

Successful Rules evidence is discarded unless a final no-cache offer revalidation remains `UNCHANGED`. SF never silently accepts provider price or guarantee changes.

## Selected-offer Availability authority

`HospitalitySupplierReservationAuthorityProvider` proves read-only authority for the selected external offer. The Travelport adapter repeats Rules/final revalidation, requires the caller's accepted offer/terms fingerprints to remain current, bridges the selected rate to Travelport booking evidence, and runs v11 Availability for the exact property, dates, occupancy, aggregator, and available rate filters.

All documented Availability continuation pages 2 through 5 are consumed with a five-page / 500-offer cap. Stable totals and unique identifiers are required. Exactly one Availability result must map to the selected SearchComplete rate and stay. Travelport's `requestedCurrency` is not treated as currency conversion; exact commercial money remains governed by SearchComplete + Rules.

The successful result returns a deterministic SHA-256 `authorityFingerprint` over provider, property, selected rate identity, Availability booking identity, stay/occupancy, accepted money, and accepted offer/terms evidence. Expiring Availability identifiers remain adapter-owned. Any future create executor must repeat this bridge immediately before the external write.

## Durable supplier reservation ledger

`HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` provide the provider-neutral idempotency/recovery substrate for future supplier writes. Operations are tenant-owned, integration/credential-version bound, authority-fingerprinted, and exact-money/stay/occupancy bound. Raw traveler PII, card/CVV data, tokens, credentials, and provider request bodies do not belong in the ledger.

The ledger can retain an optional known provider reservation locator while an operation is `AMBIGUOUS`, and persists an optional supplier confirmation reference only when the operation becomes `CONFIRMED`. This supplier confirmation is future lifecycle evidence, not an enabled cancellation capability.

See `docs/supplier-reservation-operations.md` for state, idempotency, recovery, audit, and migration rules.

## Known-locator reservation recovery

`HospitalitySupplierReservationRecoveryProvider` is the provider-neutral read contract. `TravelportStaysReservationRecoveryProvider` implements Hotel Retrieve `GET book/reservations/{AggregatorLocatorCode}` using the same tenant-owned decrypted credential authority as the loaded Travelport integration.

The adapter accepts only a bounded single-line known aggregator locator. `FOUND` requires exactly one `sourceContext=Travelport` locator matching the requested value. An optional single supplier confirmation can be returned as normalized evidence. Authentication, rate-limit, timeout, provider-unavailable, malformed, and mismatched responses remain normalized failures.

Travelport's current public Retrieve reference documents the endpoint and successful response shape but does not define a generic HTTP 404 as authoritative reservation non-existence. A generic HTTP 404 is therefore not authoritative negative evidence in SF: the adapter maps it to `INVALID_RESPONSE`, and the reconciliation coordinator returns the operation to `AMBIGUOUS` while retaining the known locator. The provider-neutral `NOT_FOUND` outcome remains reserved for a future adapter/lookup path whose negative semantics are verified against provider documentation, non-production behavior, or provider support.

`reconcileHospitalitySupplierReservationWithProvider` connects the provider-neutral adapter to the durable ledger. The tenant-authorized reconciliation claim runs before provider I/O. Provider-code mismatch fails without invoking the adapter. `FOUND` confirms only when the returned locator exactly matches the durable known locator; provider-neutral `NOT_FOUND` can return the operation to `PREPARED` only when an adapter supplies verified exact-locator negative evidence; transient/unknown failure returns to `AMBIGUOUS` while preserving the known locator for a later recovery attempt. The current Travelport Retrieve adapter does not infer `NOT_FOUND` from HTTP status alone.

Locator-less ambiguity cannot enter this automatic recovery path. Hotel Retrieve starts from an aggregator locator, so a create that disconnects before SF receives one must remain `AMBIGUOUS` until live Travelport/provider-support validation establishes another authoritative lookup or correlation mechanism.

## Reservation response evidence

`parseTravelportStaysReservationResponse` is shared by known-locator Retrieve and intended future create response handling. It normalizes only the Travelport aggregator locator, optional single supplier confirmation, and bounded correlation ID, while discarding traveler/payment/raw provider data.

Retrieve verifies exact locator identity but may accept historical/cancelled receipt state as proof the reservation record exists. Future create handling must require confirmed Travelport receipt state and confirmed supplier receipt state when present before settling the ledger as `CONFIRMED`.

See `docs/travelport-reservation-response-evidence.md`.

## Create-path payment and PCI boundary

Travelport v11 Create Reservation contracts require traveler details plus form-of-payment/payment material; documented card forms can include PAN and, for some suppliers, security code.

SF's existing online-payment security boundary does not accept raw card data. The Travelport create path therefore remains closed until SF has a reviewed PCI-safe form-of-payment/guarantee strategy supported by the provisioned account without routing PAN/CVV through normal SF application surfaces, persistence, logs, or audits.

Travelport also documents price/guarantee changes as explicit follow-up decisions. SF will not include `acceptPriceChangeInd` or `acceptGuaranteeChangeInd` on an initial create or silently opt into changes.

## Failure and privacy contract

Provider failures normalize to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INVALID_REQUEST`, or `INVALID_RESPONSE`. Unsafe identifiers, authority mismatch, malformed/mixed money, unsupported Rules shapes, duplicate/oversized structures, incomplete pagination, mismatched reservation locators, undocumented generic negative HTTP statuses, unexpected redirects, and ambiguous selected-offer mapping fail closed.

Raw Travelport errors, credentials, tokens, access groups, headers/bodies, pagination tokens, booking codes, traveler/customer data, payment/card material, provider locators, supplier confirmations, and supplier commercial payloads are not copied into audit payloads or structured request logs.

## Validation boundary

The supplier suite covers configuration/fixed endpoints, token behavior, health failure normalization, SearchComplete pagination, exact-money pricing/revalidation, Rules normalization/race handling, selected-offer Availability authority, supplier reservation state/idempotency/privacy, reservation response evidence, known-locator recovery, generic 404 fail-closed behavior, locator-preserving reconciliation, supplier-confirmation persistence, and fixed-endpoint redirect suppression.

A guarded PostgreSQL scenario is registered for cross-tenant provider-I/O suppression, locator-less recovery denial, known-locator `FOUND`, transient `UNKNOWN` preservation, provider-neutral `NOT_FOUND` clearing, mismatch rejection, and durable supplier confirmation. Its `NOT_FOUND` branch uses a provider-neutral stub and does not claim Travelport HTTP 404 semantics. It requires the repository's explicitly disposable PostgreSQL harness.

Live provider validation still requires provisioned Travelport non-production credentials. Full Prisma migration/drift/database execution requires an explicitly disposable PostgreSQL target. Source-only validation does not claim either gate passed.

## Remaining work before supplier reservation is live

1. Validate SearchComplete-to-Availability selected-rate mapping and exact request/response behavior with provisioned Travelport non-production credentials.
2. Establish a reviewed PCI-safe form-of-payment/guarantee strategy for the provisioned Travelport account.
3. Implement the real single-room Travelport create adapter and execution coordinator. It must repeat fresh Rules/offer/Availability authority, bind the accepted authority to the durable request, reconstruct only authorized traveler/guarantee/payment material, and settle every provider outcome through the ledger.
4. Validate price/guarantee-change handling, authoritative negative lookup semantics, locator-less ambiguous-write recovery, correlation semantics, and create response receipts against Travelport non-production/provider support.
5. Advertise `reservation` only after the real write/recovery contract is validated, then expose staff/customer reserve UX with complete loading/error/accessibility/responsive states.
6. Verify cancellation, modification, multi-room, and other provider lifecycle capabilities independently rather than assuming they follow from create support.

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
