# Travelport Stays integration

## Purpose

`travelport-stays` is SF's first production external hospitality supplier boundary. The implemented read path covers SearchComplete discovery, exact-money pricing/revalidation, Rules normalization, selected-offer Availability authority, encrypted credentials/OAuth, health checks, and known-locator reservation Retrieve.

The server-only write infrastructure now also contains a single-room Create Reservation executor/coordinator and a Booking.com Sync recovery-write executor/coordinator. Both remain deliberately unreachable while the integration does not advertise `reservation`. No customer/staff reserve action, modification, cancellation, refund, or public booking route calls Travelport writes.

## Provider identity and tenant ownership

Every Travelport integration belongs to one organization. Integration administration requires `integration:manage`; operational supplier reads and writes use product permissions.

The browser cannot choose a provider capability list or bypass tenant ownership. Supplier reservation operations require `booking:manage`, exact organization scope, a currently active integration, the same provider code, and the credential version captured when the operation was prepared.

The configured capability list remains read-only: `availability`, `hotel-search`, and `pricing`. `reservation`, `modification`, `cancellation`, `refund`, `ticketing`, and flight capabilities are not advertised. Because `reservation` is disabled, the Create and Sync coordinators are not product-reachable.

## Credentials, endpoints, and OAuth

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the encrypted integration credential envelope.

Provider endpoints are fixed constants selected from the validated environment. Callers cannot supply arbitrary URLs. Credential-bearing requests use `redirect: 'manual'`; unexpected redirects therefore fail through the normal non-success path and credentials are never replayed to a redirect target.

Reusable OAuth tokens are cached in-process by integration ID plus credential version, concurrent refreshes are suppressed, and 401/403 responses evict the relevant cached token. Credentials and tokens are never returned, audited, logged, or persisted outside the encrypted credential boundary.

## SearchComplete discovery and pagination

`HospitalitySupplierProvider` owns the provider-neutral search contract. Travelport v12 SearchComplete runs with `returnOnlyAvailableProperties: true`; results are normalized into SF-owned records.

SearchComplete continuation pages are consumed with bounded page/result limits, stable-total checks, and duplicate detection. Provider pagination tokens never escape into product callers.

## Exact offer pricing and revalidation

`HospitalitySupplierPricingProvider` normalizes exact-property offer pricing and revalidation. Pricing requests use no-cache authority. SF does not invent a trusted Travelport TTL; returned offers remain revalidation-required.

Provider decimal money is converted through SF integer-minor helpers. Malformed or mixed currency, invalid precision, duplicate rate identities, missing totals, and bounded-structure violations fail closed.

Fresh revalidation returns only normalized states such as `UNCHANGED`, `PRICE_CHANGED`, `OFFER_CHANGED`, or `UNAVAILABLE`. A prior observation is never treated as timeless sell authority.

## Rules and selected-offer Availability authority

`HospitalitySupplierBookingTermsProvider` normalizes Travelport v11 Rules evidence. The current reservation boundary supports one room and one to nine guests and captures exact money, payment timing, guarantee/deposit semantics, accepted credit-card codes, cancellation evidence, check-in/out times, qualification requirements, bounded text, and deterministic terms fingerprinting.

Successful Rules evidence is accepted only when a final no-cache offer revalidation remains unchanged.

`HospitalitySupplierReservationAuthorityProvider` then proves read-only authority for the exact selected offer. The Travelport adapter bridges the selected SearchComplete/Rules rate into v11 Availability, consumes bounded continuation pages, and requires exactly one matching property/rate/stay/occupancy result.

The resulting authority fingerprint covers provider, property, selected rate identity, Availability booking identity, stay/occupancy, money, and accepted offer/terms evidence. The Create submission gate repeats this authority immediately before the durable commercial-write claim.

## Durable supplier reservation ledger

`HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` are provider-neutral durable write/recovery records. Operations are tenant-owned, integration/credential-version bound, authority-fingerprinted, exact-money/stay/occupancy bound, and protected by organization-scoped advisory locks.

Raw traveler PII, card/CVV data, credentials, tokens, provider request bodies, and response bodies do not belong in the ledger.

Attempts currently distinguish:

- `CREATE` — external supplier sell;
- `RECONCILE` — read-only known-locator provider truth lookup; and
- `RECOVERY_WRITE` — external recovery write such as Booking.com Sync.

`SUBMITTING` is used for external write attempts (`CREATE` or `RECOVERY_WRITE`), while `RECONCILING` is reserved for `RECONCILE`.

The ledger can retain a known provider locator while ambiguous. It can also retain a supplier confirmation and a bounded opaque `providerRecoveryReference` when the original response proves provider-specific recovery authority.

## Server-only Create Reservation execution

`TravelportStaysReservationCreateExecutor` implements fixed v11 `POST /11/hotel/book/reservations/build` for the supported single-room reference-payload workflow.

It accepts freshly mapped offer/traveler/payment authority and an ephemeral sensitive credit-card argument. It validates card code/type/expiry and current payment authority, performs OAuth, and only sends the commercial POST after the durable provider-request marker succeeds.

`createTravelportStaysReservationWithSensitivePaymentCard` is the provider-specific coordinator. It:

1. repeats tenant-authorized offer/Rules/Availability/traveler authority;
2. claims the durable `CREATE` attempt;
3. reloads and rechecks integration/provider/credential version;
4. reconstructs exact expected Travelport property/stay/occupancy identity;
5. invokes the executor with attempt UUID as request correlation;
6. stages verified Booking.com Sync recovery evidence before create settlement when returned; and
7. settles provider output through the provider-neutral ledger.

Pre-provider deterministic failures are retry-safe only because the durable provider-request boundary was never crossed. Once marked, timeout/transport/unexpected uncertainty stays `AMBIGUOUS`; SF never blindly resells.

Price/guarantee changes remain explicit review cases. The initial Create request does not send `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`.

The Create coordinator is not exposed and does not establish a PCI-safe card collection source.

## Booking.com Sync recovery write

Travelport documents a Booking.com failure where the supplier sell succeeds but Travelport PNR processing does not complete. In that exact warning path, the hardened Create classifier records recovery authority only when the returned segment exactly matches the durable stay, has one supplier confirmation, no Travelport locator, supplier source `BO`, and a bounded matching offer authority.

The provider adapter stores only an opaque versioned recovery reference containing Travelport-owned non-secret authority. `13034` alone does not create this authority because Travelport documents that the timeout may represent either no sell or a successful Booking.com sell.

`TravelportStaysReservationSyncExecutor` implements fixed v11 `POST /11/hotel/book/reservations/`. It builds the request from:

- retained Availability offer authority;
- `passiveOfferInd=true`;
- the verified Booking.com supplier confirmation/source; and
- the complete primary traveler `PersonName`, `Telephone`, and `Email` already bound to the durable reservation payload fingerprint.

Travelport's current Sync field table marks `Traveler`, `PersonName`, and `Telephone` required and separately requires traveler email for Booking.com, even though the abbreviated request example shows only email. SF therefore uses the normative required-field contract. Create and Sync share one provider-specific traveler mapper, including the documented 22-character combined `Given` + `Surname` fail-closed check, so the two write paths cannot drift or silently accept provider-side name truncation.

The Sync request does not accept form-of-payment, PAN, CVV, cardholder, billing, arbitrary endpoint, credential, or token input.

`syncTravelportStaysBookingDotComReservation` is the server-only coordinator. It:

1. normalizes the supplied traveler and rebinds it to the durable reservation-payload fingerprint;
2. claims a tenant-scoped `RECOVERY_WRITE` only from locator-less `AMBIGUOUS` state with complete recovery evidence;
3. reloads exact integration/provider/credential-version authority;
4. builds the expected Travelport stay identity;
5. completes deterministic request construction and OAuth before the provider marker;
6. marks the provider boundary and sends Sync using the durable attempt UUID as correlation authority;
7. confirms only when the response proves the exact stay, the original supplier confirmation, and a Travelport locator; and
8. settles all uncertainty as non-retryable ambiguity.

A pre-provider recovery-write failure may be retried because `providerRequestStartedAt` proves no Sync request was sent. Once that marker exists, the operation cannot automatically repeat Sync, including after a crash/lease recovery.

Successful Sync clears the provider recovery reference. Ambiguous Sync retains recovery evidence for manual/provider-supported resolution but does not convert it into repeat authority.

See `docs/travelport-booking-sync-recovery-authority.md`.

## Known-locator reservation recovery

`TravelportStaysReservationRecoveryProvider` implements Hotel Retrieve `GET book/reservations/{AggregatorLocatorCode}` using the same tenant-owned integration credentials.

`FOUND` requires exactly one Travelport locator matching the requested durable locator. Supplier confirmation is optional normalized evidence.

Travelport public docs do not establish generic HTTP 404 as authoritative non-existence. The adapter therefore does not convert a generic 404 into provider-neutral `NOT_FOUND`; it stays unknown/invalid and the durable operation remains ambiguous with the locator preserved.

`reconcileHospitalitySupplierReservationWithProvider` claims the tenant-scoped `RECONCILE` attempt before provider I/O and uses the attempt UUID as correlation. Locator-less ambiguity cannot enter this path.

## Reservation response evidence

The hardened Travelport create/recovery response boundaries normalize only bounded operational locator/correlation evidence and exact property/stay/occupancy identity.

Create confirmation requires confirmed Travelport receipt evidence. Booking.com Sync additionally requires the exact original supplier confirmation to return with the Travelport locator. Malformed, conflicting, oversized, unknown, or non-success structures fail closed.

See `docs/travelport-reservation-response-evidence.md`.

## Payment and PCI boundary

Travelport Create Reservation can require PAN and security-code data. SF's existing online-payment boundary does not accept raw card data through ordinary application surfaces.

The server-only Create executor therefore remains unreachable until SF has a reviewed PCI-safe form-of-payment/guarantee source appropriate for the provisioned Travelport account. PAN/CVV must stay out of ordinary persistence, logs, audit records, analytics, and browser/API surfaces not specifically designed and reviewed for that scope.

Booking.com Sync itself uses no form-of-payment in SF.

## Failure, correlation, and privacy contract

Provider failures normalize into bounded SF failure codes. Provider timeouts, authentication failure, rate limits, unavailability, malformed responses, mismatched identity, unexpected redirects, and uncertain writes are normal handled states rather than exceptional assumptions.

Create and Sync use durable attempt UUIDs as E2E correlation authority.

Structured provider observations are strict allowlists containing organization UUID, attempt UUID, fixed provider/operation, result, duration, level, and timestamp. They exclude traveler data, payment/card data, supplier confirmations, recovery references, provider locators, credentials, tokens, request bodies, and response bodies.

## Validation boundary

The source suite covers Travelport configuration/endpoints, token behavior, SearchComplete pagination, pricing/revalidation, Rules, Availability authority, supplier reservation idempotency/tenant scope, response evidence, known-locator recovery, Create request/executor/coordinator behavior, crash-safe provider markers, Sync recovery-authority persistence, `RECOVERY_WRITE` lease/replay rules, shared Create/Sync traveler mapping, Sync request construction, Sync outcome verification, and privacy/source-order contracts.

A guarded PostgreSQL recovery-write scenario is registered under `npm run test:database` to validate retry-safe pre-provider failure, marker-based replay denial, traveler fingerprint binding, matching supplier-confirmation settlement, and recovery-reference clearing on success.

Live provider verification still requires provisioned Travelport non-production credentials. PostgreSQL migration/drift/database execution requires an explicitly disposable test database.

## Remaining work before reservation capability can be enabled

1. Validate SearchComplete → Rules → Availability → Create → Sync selected-rate/receipt/correlation behavior with provisioned Travelport non-production credentials.
2. Establish and review the PCI-safe form-of-payment/guarantee source for Create.
3. Implement and live-validate explicit authorized price/guarantee-change acceptance.
4. Validate authoritative `13034`, locator-less negative/correlation, and Sync ambiguity/retry semantics with Travelport non-production/provider support.
5. Advertise `reservation` only after those commercial write/recovery/payment gates pass, then expose complete customer/staff/API states.
6. Validate modification, cancellation, multi-room, and other lifecycle capabilities independently.

## Current Travelport references

- SearchComplete: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm`
- Availability: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm`
- Rules: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesFullPayload.htm`
- Create Reservation: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm`
- Sync Reservation: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm`
- Retrieve Reservation: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm`
- Stays APIs Guide: `https://developer.travelport.com/docs/stays/guides/stays-general-guide`
