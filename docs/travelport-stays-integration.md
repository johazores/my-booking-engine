# Travelport Stays integration

## Purpose

`travelport-stays` is SF's first production external hospitality supplier boundary. The implemented read path covers SearchComplete discovery, exact-money pricing/revalidation, Rules normalization, selected-offer Availability authority, encrypted credentials/OAuth, health checks, and known-locator reservation Retrieve.

The server-only write infrastructure contains single-room Create Reservation, Booking.com Sync recovery, explicit price/guarantee review acceptance, and the one-time reviewed second-Create path. These remain deliberately unreachable from product flows while the integration does not advertise `reservation`. No customer/staff reserve action, modification, cancellation, refund, or public booking route calls Travelport writes.

## Provider identity and tenant ownership

Every Travelport integration belongs to one organization. Integration administration requires `integration:manage`; operational supplier reads/writes require their server-side product permissions.

Supplier reservation operations require exact organization scope, `booking:manage`, a currently active integration, the same provider code, and the credential version captured when the operation was prepared. Commercial review/consumption also requires `availability:read` and `pricing:read` before credentials are used.

The configured capability list remains read-only: `availability`, `hotel-search`, and `pricing`. `reservation`, `modification`, `cancellation`, `refund`, `ticketing`, and flight capabilities are not advertised. Because `reservation` is disabled, Create, reviewed Create, Sync, and commercial-review coordinators are not product-reachable.

## Credentials, endpoints, and OAuth

Travelport configuration stores environment (`pre-production` or `production`), username, password, client ID, client secret, and access group inside the encrypted integration credential envelope.

Provider endpoints are fixed constants selected from the validated environment. Credential-bearing requests use `redirect: 'manual'`; unexpected redirects fail through the normal non-success path and credentials are never replayed to a redirect target.

Reusable OAuth tokens are cached in-process by integration ID plus credential version, concurrent refreshes are suppressed, and 401/403 responses evict the relevant cached token. Credentials and tokens are never returned, audited, logged, or persisted outside the encrypted credential boundary.

## SearchComplete, Rules, and Availability authority

`HospitalitySupplierProvider` owns the provider-neutral search contract. Travelport v12 SearchComplete runs with `returnOnlyAvailableProperties: true`; continuation pages are consumed with bounded page/result limits, stable-total checks, and duplicate detection. Provider pagination tokens never escape into product callers.

Pricing requests use no-cache authority and exact integer-minor money. Malformed or mixed currency, invalid precision, duplicate rate identities, missing totals, and bounded-structure violations fail closed. A prior offer is never treated as timeless sell authority.

`HospitalitySupplierBookingTermsProvider` normalizes v11 Rules evidence for the current single-room boundary, including payment/guarantee timing, accepted card codes, cancellation evidence, qualification requirements, bounded text, and deterministic terms fingerprinting. Rules are accepted only when a final no-cache offer revalidation is unchanged.

`HospitalitySupplierReservationAuthorityProvider` bridges the exact selected SearchComplete/Rules rate into v11 Availability, consumes bounded continuation pages, and requires exactly one matching property/rate/stay/occupancy result. The resulting authority fingerprint covers provider, property, selected rate identity, Availability booking identity, stay/occupancy, money, and accepted offer/terms evidence. Expiring provider submission references remain ephemeral and are re-established before a write.

## Durable supplier reservation ledger

`HospitalitySupplierReservationOperation` and `HospitalitySupplierReservationAttempt` are provider-neutral durable write/recovery records. Operations are tenant-owned, integration/credential-version bound, authority-fingerprinted, exact-money/stay/occupancy bound, and protected by organization-scoped advisory locks.

Raw traveler PII, card/CVV data, credentials, tokens, provider request bodies, and response bodies do not belong in the ledger.

Attempts distinguish `CREATE` external sells, `RECONCILE` read-only known-locator truth lookup, and `RECOVERY_WRITE` external recovery writes such as Booking.com Sync. A definitive Travelport price/guarantee no-sell response transitions the current Create operation/attempt to `REVIEW_REQUIRED`, which remains blocked from ordinary submission/retry.

## Initial Create Reservation execution

`TravelportStaysReservationCreateExecutor` implements fixed v11 Create Reservation for the supported single-room reference-payload workflow. It receives freshly mapped offer/traveler/payment authority plus one ephemeral sensitive credit-card value. It validates card code/type/expiry, optional billing/telephone data, and current payment authority, performs OAuth, and sends the commercial POST only after the durable provider-request marker succeeds.

`createTravelportStaysReservationWithSensitivePaymentCard` is the initial provider-specific coordinator. Despite the legacy internal symbol name, raw card data is no longer accepted in its ordinary request object. The coordinator requires a separate `TravelportStaysReservationPaymentCardSource` capability, repeats fresh offer/Rules/Availability/traveler authority, claims the durable `CREATE` attempt, rechecks exact integration/credential version, and only then asks the source for one ephemeral card using the exact tenant/reservation/integration/attempt context and `INITIAL_CREATE` purpose.

The source result is passed directly to the Travelport executor. It is never added to the reservation operation, attempt, audit metadata, provider observation, request fingerprint, or application logs. The initial Create never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`.

Pre-provider deterministic/source failures are retry-safe only because the protected provider-write boundary was never crossed; retryability itself still comes from the provider-neutral classifier. Once marked, timeout/transport/unexpected uncertainty stays `AMBIGUOUS`; SF never blindly resells.

## Explicit price/guarantee review and second Create

Documented Travelport price/guarantee no-sell responses persist as `REVIEW_REQUIRED`. `acceptTravelportStaysReservationCommercialReview` verifies the exact marked/completed Create attempt, explicit accepted dimensions, traveler identity, integration identity, fresh SearchComplete, Rules, Availability, and payment authority before persisting bounded acceptance evidence. The operation remains `REVIEW_REQUIRED`, so normal retry stays blocked.

`reviewTravelportStaysReservationAcceptedCommercialAuthority` is the separate read-only pre-consumption gate. It reconstructs the durable acceptance fingerprint and repeats fresh accepted offer/Rules/Availability/traveler/integration/payment authority. It does not create an attempt or call Create.

`createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard` implements the one-time second sell. Raw card data is also absent from this coordinator request object. After accepted authority and exact integration identity are revalidated, it acquires one ephemeral card through the same source capability with purpose `REVIEW_ACCEPTANCE_CREATE`.

The executor completes deterministic card/request validation, reviewed query selection, serialization, and OAuth first. Its provider-request callback then runs `consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest` under the tenant operation advisory lock. That serializable transaction reconstructs the accepted decision, rechecks the review attempt and integration authority, creates exactly one next `CREATE` attempt, archives immutable acceptance history, moves the operation to `SUBMITTING`, clears the active acceptance slot, and persists the provider-request marker immediately before the external POST.

If deterministic work, source acquisition, or OAuth fails before consumption, no second attempt exists and the accepted decision remains unconsumed. After consumption the acceptance is single-use. Transport uncertainty cannot authorize replay; even a definitive provider failure is non-retryable through normal Create. Another provider commercial change creates a new `REVIEW_REQUIRED` cycle while prior accepted evidence remains immutable.

The reviewed executor sends only the accepted `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` query parameter and never sends a false/unaccepted flag.

See `docs/supplier-reservation-review-acceptance.md`.

## Booking.com Sync recovery write

Travelport documents a Booking.com failure where the supplier sell succeeds but Travelport PNR processing does not complete. In that exact warning path, Create records recovery authority only when the response proves the supported supplier/stay/offer contract. `13034` alone does not create this authority because the timeout may represent either no sell or a successful supplier sell.

`TravelportStaysReservationSyncExecutor` implements fixed v11 Sync. It uses retained Availability offer authority, `passiveOfferInd=true`, verified Booking.com supplier confirmation/source, and the complete primary traveler already bound to the reservation payload fingerprint. It accepts no form-of-payment, PAN, CVV, cardholder, arbitrary endpoint, credential, or token input.

`syncTravelportStaysBookingDotComReservation` claims a tenant-scoped `RECOVERY_WRITE` only from locator-less `AMBIGUOUS` state with complete recovery evidence, completes request construction/OAuth before the provider marker, and confirms only when the exact stay, original supplier confirmation, and one Travelport locator return. Once marked, uncertainty is never automatic retry authority.

See `docs/travelport-booking-sync-recovery-authority.md`.

## Known-locator reservation recovery

`TravelportStaysReservationRecoveryProvider` implements Hotel Retrieve by Travelport locator using the same tenant integration credentials. `FOUND` requires exactly one matching Travelport locator. Generic HTTP 404 is not treated as authoritative non-existence unless the provider contract proves it.

`reconcileHospitalitySupplierReservationWithProvider` claims the tenant-scoped read-only `RECONCILE` attempt before provider I/O. Locator-less ambiguity cannot enter this path.

## Payment and PCI boundary

Travelport Create Reservation can require PAN/security-code data. SF's ordinary online-payment boundary does not accept raw card data through general application surfaces.

`TravelportStaysReservationPaymentCardSource` is now the explicit server-only handoff contract for initial and reviewed Create. Its context is non-sensitive: organization ID, reservation ID, integration ID/version, attempt ID, and fixed purpose. The source contract fails closed when unavailable or malformed. Provider-specific card authority remains checked inside the Travelport adapter.

This interface is **not** a concrete PCI-safe implementation. The repository deliberately contains no fake vault, hosted-field flow, collection route, or mock production card integration. A reviewed source for the provisioned Travelport commercial account is still required. PAN/CVV must stay out of Prisma, logs, audits, analytics, queues, request fingerprints, and ordinary browser/API payloads.

Booking.com Sync uses no form-of-payment in SF.

## Failure, correlation, and privacy contract

Provider failures normalize into bounded SF failure codes. Provider timeouts, authentication failure, rate limits, unavailability, malformed responses, mismatched identity, unexpected redirects, source failures, and uncertain writes are handled states rather than exceptional assumptions.

Create, reviewed Create, and Sync use durable attempt UUIDs as E2E correlation authority. Structured provider observations are strict allowlists and exclude traveler/card data, supplier confirmations, recovery references, provider locators, credentials, tokens, request bodies, and response bodies.

## Validation boundary

Checked-in source/behavior contracts cover configuration/endpoints, token behavior, SearchComplete pagination, pricing/revalidation, Rules, Availability authority, reservation idempotency/tenant scope, response evidence, known-locator recovery, initial Create, payment-source isolation, crash-safe provider markers, Sync recovery, review-required settlement, durable review acceptance, accepted-review revalidation, one-time reviewed consumption/history, second-request flag isolation, repeated-review settlement, and privacy/order constraints.

Guarded PostgreSQL scenarios still require an explicitly disposable database. Live provider verification still requires provisioned Travelport non-production credentials.

Travelport `reservation` remains disabled until the concrete reviewed PCI-safe source, live end-to-end provider validation, and authoritative `13034`/locator-less correlation semantics are complete.
