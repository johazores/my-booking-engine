# Travelport Stays integration

## Purpose

This document defines SF's first production external hospitality supplier boundary. The implemented read-side boundary covers complete normalized hotel discovery, exact-money SearchComplete offer pricing, mandatory fresh offer revalidation, normalized Travelport v11 Rules evidence, credential authentication, and connection health verification. SF also has a provider-neutral durable reservation-operation ledger for future external writes, but no Travelport reservation create call, modification/cancellation call, or customer/staff reserve action is exposed yet.

## Provider identity and tenant ownership

SF uses provider code `travelport-stays`. Each configured record is owned by exactly one organization through the existing `Integration` model and is managed through `integration:manage`. The browser cannot submit an organization ID or capability list.

The server currently derives the implemented Travelport capability list as `availability`, `hotel-search`, and `pricing`. Migration `20260906033000_travelport-stays-pricing-capabilities` upgrades active/disabled Travelport records to that capability set while deliberately leaving archived capability history unchanged. `reservation`, `modification`, `cancellation`, `refund`, `ticketing`, and flight capabilities are not advertised.

Operational supplier reads use product permissions rather than integration-administration permissions. Property discovery requires tenant-scoped `availability:read`. Offer pricing, revalidation, and booking-rule review require both `availability:read` and `pricing:read`. All permission checks complete before the active encrypted Travelport integration is loaded, so credential access never substitutes for product authorization.

The provider-neutral reservation-operation persistence service requires server-side `booking:manage`, but its claim/reconciliation boundary additionally requires the selected integration to advertise `reservation`. Because current Travelport configuration intentionally does not advertise that capability, the ledger cannot accidentally become an unimplemented provider write path.

## Credentials and token lifecycle

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the existing encrypted integration credential envelope. Provider endpoints are fixed constants selected from the validated environment; callers cannot supply arbitrary URLs.

Travelport documents a 24-hour TripServices access-token lifetime and token reuse. SF caches tokens in process by Integration ID plus credential version, suppresses duplicate concurrent refreshes, refreshes before expiry, and evicts a cached token after provider authentication rejection. Rotation changes the cache key automatically. The Rules adapter uses the same credential-version cache authority for its v12 bridge and v11 Rules requests. Token values and credential headers are never returned, logged, audited, or persisted outside the encrypted credential envelope.

## Property discovery and pagination

`HospitalitySupplierProvider` owns the provider-neutral property-search contract. Search input is bounded to city IATA code, local stay dates, room/adult counts, optional child ages, and radius. Travelport v12 SearchComplete is called with `returnOnlyAvailableProperties: true` and responses are rebuilt into SF-owned property records.

A property result contains only an opaque `supplierPropertyReference`, display name, normalized nullable property type, and availability. The opaque reference carries the Travelport chain/property identity and authority needed for an exact-property follow-up; provider-specific identifiers are not exposed as first-class product fields.

SearchComplete page 1 can return up to 100 properties. The documented continuation endpoint is `GET search/searchcomplete/{SearchIdentifier}?pageNumber={x}` for pages 2 through 5. SF consumes at most five pages / 500 properties, requires stable totals, rejects duplicate property references and page mismatches, and never returns the opaque Travelport pagination token from the complete product search result.

## Exact offer pricing contract

`HospitalitySupplierPricingProvider` extends the normalized supplier contract with exact-property offer search and revalidation. `searchPropertyOffers` accepts the opaque property reference, stay/occupancy, and requested three-letter currency. The Travelport adapter issues a v12 SearchComplete request using `propertyKeys`, `requestedCurrency`, `returnOnlyAvailableProperties: true`, and `returnCompleteNightlyRateBreakdown: true`.

Pricing requests add Travelport's `TVP-Cache-Control: no-cache` header. Travelport documents this as the real-time pricing mode, but also instructs consumers to make a final price check before booking. SF therefore does **not** assign a trusted offer TTL. Every normalized result has `validUntil: null`, `providerCacheMode: NO_CACHE`, and `revalidationRequired: true`.

Provider decimal amounts are converted through SF's shared currency/minor-unit money boundary. Rates are rejected when currency is malformed/mixed, amount precision exceeds the currency's runtime minor-unit precision, mandatory totals are absent, the response exceeds bounded room/rate limits, or a duplicate provider rate identity is returned. SF does not perform floating-point commercial arithmetic.

Each normalized offer includes opaque property/offer references, room/rate descriptions, bounded available quantity, exact integer-minor money, normalized rate terms/inclusions, and a deterministic SHA-256 `offerFingerprint`. `rulesRequiredBeforeReservation: true` remains part of the SearchComplete observation because SearchComplete terms are not accepted as final rule authority.

## Revalidation semantics

`revalidatePropertyOffer` always performs another no-cache exact-property SearchComplete request. The caller supplies the selected offer reference, expected exact total, and expected normalized offer fingerprint. The adapter verifies ownership and returns `UNCHANGED`, `PRICE_CHANGED`, `OFFER_CHANGED`, or `UNAVAILABLE`.

Revalidation still returns `validUntil: null`. It is a fresh observation, not a durable reservation guarantee.

## Pre-reservation Rules authority

`HospitalitySupplierBookingTermsProvider` is the provider-neutral rule-evidence boundary. The Travelport implementation uses the v11 full-payload Rules endpoint `rules/offershospitality/buildfromrequest`; no Travelport request model or raw identifier is exposed through the booking domain.

The current SearchComplete offer reference intentionally contains only the opaque rate identity required for product-safe revalidation. Travelport v11 Rules additionally needs the provider `bookingCode` and, when returned, rate-code details. The Rules adapter therefore performs an internal no-cache exact-property SearchComplete bridge, matches exactly one selected `rateKey`, verifies the expected currency and exact total, and extracts `bookingCode` plus optional `rateCode` / `ratePlanID` / `rateCategory` only inside the provider adapter.

The full Rules request sends the selected property, dates, one-room occupancy, exact stored amount/currency, Travelport/Booking aggregator authority, and documented guest-count structure. Travelport Rules allows one to nine guests for this request. SF deliberately rejects multi-room Rules review today rather than inventing undocumented room-candidate semantics for the v12-to-v11 bridge; multi-room supplier booking remains a future independently verified provider capability.

Rules responses are normalized into bounded SF-owned evidence: exact integer-minor base/tax/fee/total money; payment timing and recognized guarantee types; loyalty/check-in qualification requirements; structured cancellation deadlines/penalties; deposits; accepted payment-card codes; check-in/check-out times; bounded rule text; a deterministic `termsFingerprint`; `completeForReservationReview`; and `revalidationRequired: true`.

Unknown guarantee semantics never become booking authority. Unsupported cancellation-penalty structures fail closed. Successful Rules evidence is discarded unless a final no-cache `revalidatePropertyOffer` still returns `UNCHANGED` after the Rules call, closing the obvious race where the selected provider offer changes while full rules are fetched.

Rules evidence does not authorize or create a reservation. SF does not silently send Travelport price- or guarantee-change acceptance flags without a separately reviewed user/commercial decision.

## Durable external-write operation ledger

`HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` provide the provider-neutral persistence/recovery substrate required before any Travelport create call is allowed.

A prepared operation is organization-owned and bound to the selected Integration ID plus credential version. Its organization-scoped idempotency key maps to a SHA-256 request fingerprint covering the provider/property/offer authority, accepted offer fingerprint, accepted Rules fingerprint, exact money/stay/occupancy, and a required `reservationPayloadFingerprint`. The ledger stores that payload fingerprint rather than raw traveler PII, guarantee credentials, card data, provider tokens, or the future provider request body.

Create/reconciliation claims use server-side `booking:manage`, tenant-scoped integration ownership, serializable transactions, advisory locks, and a fresh check that provider code, credential version, active status, and `reservation` capability still match the reviewed request. Credential/configuration changes therefore fail closed and require the commercial flow to be reviewed again.

Operation states are `PREPARED`, `SUBMITTING`, `CONFIRMED`, `AMBIGUOUS`, `RECONCILING`, and `FAILED`. A known retryable failure may be claimed again. An ambiguous create may **not** be retried; it must enter reconciliation. Reconciliation can only prove `FOUND` (confirm with provider reservation reference), `NOT_FOUND` (return to prepared/safe-to-create), or `UNKNOWN` (stay ambiguous). This prevents timeout/disconnect uncertainty from creating duplicate supplier reservations.

The database enforces tenant-safe integration/attempt relationships, exact-idempotency uniqueness, fingerprint/money/date/occupancy bounds, confirmed provider-reference requirements, normalized failure evidence, single-line provider metadata, and unique provider reservation references within the tenant/integration.

This ledger is intentionally separate from first-party `HospitalityBooking`; external supplier inventory does not fabricate local property/room/rate/hold/allocation identifiers. See `docs/supplier-reservation-operations.md`.

## Failure and privacy contract

Provider read failures normalize to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `INVALID_REQUEST`, or `INVALID_RESPONSE`. Only rate-limit, provider-unavailable, and timeout are retryable. Malformed provider data, forged opaque references, unsupported authority, unsafe page tokens, mixed currencies, invalid money precision, ownership mismatches, unsupported Rules shapes, and oversized/duplicate result structures fail closed.

The reservation ledger persists only normalized failure codes/retryability plus bounded provider reference/correlation evidence needed for recovery. Raw Travelport errors, credentials, tokens, access groups, request headers/bodies, provider response bodies, pagination tokens, rate keys, booking codes, property keys, traveler/customer data, guarantee/payment material, and supplier commercial payloads are not copied into audits or structured request logs.

## Management and observability

`POST /api/integrations/travelport-stays` configures or rotates the tenant-owned integration. `POST /api/integrations/travelport-stays/test` performs the explicit administrator health check and records only normalized current-credential health evidence. Existing integration enable/disable/archive/reconnection semantics remain provider-neutral.

Supplier discovery, pricing, revalidation, and Rules review are server services. Reservation persistence is also server-only infrastructure. There is still no customer-facing external-supplier booking route, fake reservation action, or mock Travelport success path.

## Validation boundary

The supplier suite covers configuration/fixed endpoints, token request/caching/eviction, health failure normalization, SearchComplete discovery/pagination/opaque identity, exact-money pricing, no-cache revalidation, commercial fingerprints, Rules request/normalization/race handling, and the new supplier reservation operation state/idempotency/privacy contract. A guarded PostgreSQL scenario is checked in for tenant isolation, exact retry, ambiguity reconciliation, durable attempt ordering, confirmation, and credential-version invalidation.

Live provider validation still requires a specifically provisioned Travelport non-production account. Full Prisma migration/drift/database execution still requires the repository's explicitly disposable PostgreSQL target. Neither is claimed by source-only validation.

## Remaining work before supplier reservation is live

1. Implement the real Travelport single-room reservation create adapter and the provider-truth retrieval/reconciliation path, wiring every provider write outcome through the durable operation ledger.
2. Verify the exact Travelport identifiers, correlation/recovery semantics, guarantee/payment request boundary, and explicit price/guarantee-change handling against a provisioned non-production Stays account.
3. Advertise `reservation` only after that real provider write/retrieve contract is implemented and validated; until then current Travelport configuration stays read/pricing-only.
4. Only then expose a real staff/customer supplier search/selection/reserve surface with complete loading, empty, error, accessibility, and responsive states.
5. Expand independently to verified multi-room and provider-supported retrieve/modify/cancel semantics rather than assuming they match the first reservation path.

## Current Travelport references

- SearchComplete v12: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- SearchComplete pagination: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete_pagination.htm
- Hotel Rules full payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm
- Hotel Rules response/reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Create Reservation full payload/change checks: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationFullPayload.htm
- Reservation Retrieve (multi-content): https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/Book/APIRef_ReservationRetrieve.htm
