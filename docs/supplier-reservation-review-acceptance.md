# Supplier reservation commercial-review acceptance

## Purpose

Travelport can reject an initial hotel sell with a definitive no-sell price and/or guarantee change. SF persists those outcomes as `REVIEW_REQUIRED`. The production write infrastructure now implements the full server-only decision/consumption boundary: an authorized actor accepts the exact commercial change, SF re-establishes fresh supplier authority, and one accepted decision can be consumed into exactly one second Create attempt.

This does not expose reservation UX, create a card-collection surface, or advertise the Travelport `reservation` capability. The reviewed second sell remains unreachable from product flows while the PCI-safe form-of-payment source and live provider activation gates remain open.

Travelport documents `acceptPriceChangeInd=true` and `acceptGuaranteeChangeInd=true` as second-request query parameters. They must not be sent on the initial Create Reservation request. An SF acceptance decision therefore remains separate from normal retry authority.

## Authorization and tenant scope

`acceptTravelportStaysReservationCommercialReview`, `reviewTravelportStaysReservationAcceptedCommercialAuthority`, and the reviewed second-sell coordinator are server-only. The authority/consumption boundaries require:

- `availability:read`;
- `pricing:read`; and
- `booking:manage`.

The reservation operation is loaded with both operation ID and organization ID. The workflow accepts only the current single-room `travelport-stays` `REVIEW_REQUIRED` operation with request-fingerprint version 2 and one of the three fixed review reasons.

The actor must explicitly accept exactly the pending dimensions:

- `SUPPLIER_PRICE_CHANGED` -> price only;
- `SUPPLIER_GUARANTEE_CHANGED` -> guarantee only; or
- `SUPPLIER_PRICE_AND_GUARANTEE_CHANGED` -> both.

Partial acceptance of a combined change and acceptance of an unrelated dimension fail closed.

## Durable provider-write evidence

`REVIEW_REQUIRED` on the operation row is not sufficient by itself to authorize a commercial decision. SF also requires the current durable `CREATE` attempt to match the operation attempt count, be settled as `REVIEW_REQUIRED`, carry the same normalized review reason, and contain both the durable provider-request marker and a valid completion timestamp. The review settlement records that completion time from the PostgreSQL clock after the original provider marker has already been persisted.

This prevents an inconsistent, stale, manually altered, or partially persisted operation row from becoming acceptance authority. After fresh supplier authority is reviewed, the same attempt is rechecked under the operation advisory lock before any acceptance fields are persisted. The exact attempt record must still be the one that produced the pending review.

## Fresh authority before durable acceptance

The previous failed sell is not commercial authority for a later decision. Before the decision is persisted, SF:

1. rebinds the primary traveler to the existing durable traveler fingerprint;
2. requires the same active tenant integration, provider code, credential version, and `reservation` capability;
3. revalidates the selected offer with real-time SearchComplete pricing;
4. requires the current price-change condition to match the pending decision;
5. retrieves fresh Rules against the current offer price/fingerprint;
6. requires complete reservation-review terms and a supported customer-loyalty boundary;
7. repeats the reservation-authority adapter, which re-runs fresh SearchComplete, Rules, and bounded Availability matching; and
8. derives a supported current payment/guarantee authority.

Any provider drift, unavailable offer, unrelated price change, incomplete Rules, unsupported payment authority, integration rotation, traveler change, attempt mismatch, or authority race prevents acceptance.

The expiring Travelport `CatalogOfferingIdentifier` is deliberately not persisted as acceptance authority.

## Durable decision integrity

Until consumption starts, the supplier reservation operation remains `REVIEW_REQUIRED`; normal submission therefore stays blocked.

An accepted decision persists only bounded non-secret commercial evidence:

- actor user ID and acceptance time;
- current review attempt sequence;
- the exact accepted dimensions;
- currency and exact accepted total in integer minor units;
- current offer, Rules-terms, and Availability-authority fingerprints; and
- a versioned acceptance fingerprint binding those values to the reservation ID, accepting actor, review reason, attempt, and immutable traveler payload fingerprint.

The active acceptance fields are all-null or all-present under a database check constraint. When present, the operation must still be `REVIEW_REQUIRED`, the accepted dimensions must match the fixed review reason, accepted currency must match the operation currency, and the accepted attempt sequence must equal the current attempt count.

`assertHospitalitySupplierReservationStoredReviewAcceptance` reconstructs the versioned acceptance fingerprint from those durable fields before any consumption path can rely on them. It also rejects acceptance evidence outside `REVIEW_REQUIRED`, stale attempt binding, retryable state, or rows carrying provider reservation/recovery evidence.

The audit event `supplier.reservation-review-accepted` contains bounded commercial metadata and the acceptance fingerprint. It does not contain provider payloads, traveler PII, PAN, CVV, cardholder details, credentials, or the expiring provider submission reference.

## Fresh authority before consumption

`reviewTravelportStaysReservationAcceptedCommercialAuthority` is the read-only pre-consumption gate. It does not mutate the operation or attempts and cannot call Create Reservation.

The caller must provide the exact expected acceptance fingerprint. SF then:

1. tenant-loads the operation and reconstructs the stored acceptance fingerprint;
2. rechecks the exact durable review attempt and accepted change dimensions;
3. rebinds the primary traveler fingerprint;
4. requires the same active tenant integration/provider/credential version and `reservation` capability;
5. requires fresh SearchComplete to return the same supplier property, supplier offer, accepted total, currency, and accepted offer fingerprint;
6. requires fresh Rules to preserve the exact accepted terms fingerprint;
7. requires fresh Availability authority to preserve the exact accepted authority fingerprint and provide a current expiring submission reference; and
8. re-derives supported current payment/guarantee authority.

Any mismatch fails while the operation remains `REVIEW_REQUIRED` and the accepted decision remains unconsumed. This keeps provider drift, stale acceptance, and transient authority failure from creating a durable second-write attempt.

## One-time consumption and second Create

`createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard` is a separate server-only coordinator. It cannot be reached through normal retry or the initial Create coordinator.

The coordinator first completes the read-only authority gate, builds the current request material, generates the next attempt UUID, reloads the exact integration/credential version, and invokes `TravelportStaysReservationCreateExecutor.createReservationAfterAcceptedReview`.

The executor completes all deterministic card/request validation, reviewed query selection, request serialization, and OAuth before calling its provider-request callback. The callback then runs `consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest` under the organization-scoped operation advisory lock. In one serializable transaction SF:

1. reconstructs and compares the exact expected acceptance fingerprint;
2. rechecks the original marked/completed review attempt and accepted change dimensions;
3. rechecks the active integration/provider/credential version and reservation capability;
4. creates the next `CREATE` attempt with one database-clock timestamp for `startedAt`, `leaseStartedAt`, and `providerRequestStartedAt`;
5. copies the complete bounded accepted decision into `HospitalitySupplierReservationReviewAcceptanceHistory`;
6. binds that immutable history row to both the original review sequence and the new consumed Create sequence;
7. moves the operation to `SUBMITTING`, increments `attemptCount`, and clears every active acceptance field; and
8. records `supplier.reservation-reviewed-provider-request-started` without provider payloads, traveler PII, or card data.

The history table has tenant/reservation-scoped uniqueness for review sequence, consumed Create sequence, and acceptance fingerprint. Its consumed attempt is also a database foreign key to the exact reservation attempt. The database contract requires the consumed sequence to be exactly the review sequence plus one and preserves the exact reason/accepted-dimension mapping.

Only after that transaction commits does the executor issue the external POST. If request composition or OAuth fails, no new attempt exists and the accepted decision remains available for an authorized retry. If the transaction commits, the acceptance is single-use: transport uncertainty follows the existing `AMBIGUOUS`/recovery path, and even a definitive provider failure is persisted non-retryable rather than allowing normal submission to omit or silently reuse the reviewed flags.

The reviewed executor adds only the accepted query flags whose durable decision value is `true`. The initial Create method always enters the shared executor with no reviewed acceptance and therefore never sends either flag.

If the second provider response reports another price and/or guarantee change, settlement creates a new `REVIEW_REQUIRED` cycle. The prior accepted decision remains immutable in history, while the active acceptance slot is empty and must be explicitly accepted again against fresh authority.

## What remains closed

The one-time accepted-review second-write infrastructure is implemented, but Travelport `reservation` remains deliberately unadvertised and product-unreachable.

Activation still requires:

- a reviewed PCI-safe FormOfPayment/guarantee source appropriate for the provisioned Travelport account;
- live non-production SearchComplete -> Rules -> Availability -> initial Create -> reviewed second Create -> Sync/recovery verification;
- authoritative `13034` and locator-less correlation/retry semantics with Travelport/provider evidence; and
- complete product/API states only after those commercial-write/payment/recovery gates pass.

Normal retry must never be able to reach the reviewed second-sell path.

## Provider references

Travelport's current Create Reservation reference/full-payload documentation states that `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` are Boolean query parameters for the second request only after a price or guarantee change prevents the first sell. Travelport's Stays guide likewise states not to send either parameter on the first reservation request.
