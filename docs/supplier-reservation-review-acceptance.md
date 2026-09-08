# Supplier reservation commercial-review acceptance

## Purpose

Travelport can reject an initial hotel sell with a definitive no-sell price and/or guarantee change. SF persists those outcomes as `REVIEW_REQUIRED`. The production write infrastructure implements the full server-only decision/consumption boundary: an authorized actor accepts the exact commercial change, SF re-establishes fresh supplier authority, and one accepted decision can be consumed into exactly one second Create attempt.

This does not expose reservation UX, create a card-collection surface, or advertise the Travelport `reservation` capability. The reviewed second sell remains unreachable from product flows while the concrete PCI-safe form-of-payment source and live provider activation gates remain open.

Travelport documents `acceptPriceChangeInd=true` and `acceptGuaranteeChangeInd=true` as second-request query parameters. They must not be sent on the initial Create Reservation request. An SF acceptance decision therefore remains separate from normal retry authority.

## Authorization and tenant scope

`acceptTravelportStaysReservationCommercialReview`, `reviewTravelportStaysReservationAcceptedCommercialAuthority`, and the reviewed second-sell coordinator are server-only. The authority/consumption boundaries require `availability:read`, `pricing:read`, and `booking:manage`.

The reservation operation is loaded with both operation ID and organization ID. The workflow accepts only the current single-room `travelport-stays` `REVIEW_REQUIRED` operation with request-fingerprint version 2 and one of the three fixed review reasons.

The actor must explicitly accept exactly the pending dimensions:

- `SUPPLIER_PRICE_CHANGED` -> price only;
- `SUPPLIER_GUARANTEE_CHANGED` -> guarantee only; or
- `SUPPLIER_PRICE_AND_GUARANTEE_CHANGED` -> both.

Partial acceptance of a combined change and acceptance of an unrelated dimension fail closed.

## Durable provider-write evidence

`REVIEW_REQUIRED` on the operation row is not sufficient by itself to authorize a commercial decision. SF also requires the current durable `CREATE` attempt to match the operation attempt count, be settled as `REVIEW_REQUIRED`, carry the same normalized review reason, and contain both the durable provider-request marker and a valid completion timestamp.

This prevents an inconsistent, stale, manually altered, or partially persisted operation row from becoming acceptance authority. After fresh supplier authority is reviewed, the same attempt is rechecked under the operation advisory lock before acceptance fields are persisted.

## Fresh authority before durable acceptance

The previous failed sell is not commercial authority for a later decision. Before the decision is persisted, SF rebinds the durable traveler fingerprint, requires the same active tenant integration/provider/credential version and `reservation` capability, revalidates the selected offer, retrieves fresh Rules, repeats selected-offer Availability authority, and derives supported current payment/guarantee authority.

Any provider drift, unavailable offer, unrelated price change, incomplete Rules, unsupported payment authority, integration rotation, traveler change, attempt mismatch, or authority race prevents acceptance. The expiring Travelport `CatalogOfferingIdentifier` is deliberately not persisted as acceptance authority.

## Durable decision integrity

Until consumption starts, the supplier reservation operation remains `REVIEW_REQUIRED`; normal submission therefore stays blocked.

An accepted decision persists only bounded non-secret commercial evidence: actor/time, current review attempt sequence, exact accepted dimensions, currency and exact accepted total in integer minor units, current offer/Rules/Availability fingerprints, and a versioned acceptance fingerprint binding those values to reservation, actor, review reason, attempt, and immutable traveler payload fingerprint.

The active acceptance fields are all-null or all-present under a database check constraint. `assertHospitalitySupplierReservationStoredReviewAcceptance` reconstructs the versioned acceptance fingerprint from those durable fields before any consumption path can rely on them and rejects stale or structurally inconsistent evidence.

The audit event `supplier.reservation-review-accepted` contains bounded commercial metadata and the acceptance fingerprint. It does not contain provider payloads, traveler PII, PAN, CVV, cardholder details, credentials, or the expiring provider submission reference.

## Fresh authority before consumption

`reviewTravelportStaysReservationAcceptedCommercialAuthority` is the read-only pre-consumption gate. It does not mutate the operation or attempts and cannot call Create Reservation.

The caller must provide the exact expected acceptance fingerprint. SF tenant-loads and reconstructs stored acceptance, rechecks the exact review attempt/dimensions, rebinds the traveler, requires the same active integration/provider/credential version, requires fresh SearchComplete to preserve property/offer/accepted total/currency/fingerprint, requires fresh Rules to preserve accepted terms, requires fresh Availability to preserve accepted authority and provide a current expiring submission reference, and re-derives payment/guarantee authority.

Any mismatch fails while the operation remains `REVIEW_REQUIRED` and the accepted decision remains unconsumed.

## Payment source before the second Create

The reviewed coordinator does not accept raw card material in its ordinary request object. It requires a separately supplied `TravelportStaysReservationPaymentCardSource` capability.

Only after accepted commercial authority, current request material, and exact integration/credential identity have been revalidated does the coordinator call `acquireTravelportStaysReservationPaymentCard` with the exact organization, reservation, integration, credential version, generated next attempt ID, and `REVIEW_ACCEPTANCE_CREATE` purpose.

The source contract itself contains no PAN, CVV, cardholder, billing address, or payment telephone. If source acquisition fails, no new Create attempt has been consumed and the durable acceptance remains available for a later authorized attempt. Provider-specific card/payment checks remain inside the Travelport Create executor.

This source interface narrows the sensitive-data boundary but is not a concrete PCI implementation. No fake vault, hosted-field flow, collection route, or mock production source is provided by the repository.

## One-time consumption and second Create

`createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard` is a separate server-only coordinator. It cannot be reached through normal retry or the initial Create coordinator.

After the source returns one ephemeral card, the executor completes deterministic card/request validation, reviewed query selection, request serialization, and OAuth before calling its provider-request callback. The callback then runs `consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest` under the organization-scoped operation advisory lock.

In one serializable transaction SF reconstructs and compares the exact expected acceptance fingerprint, rechecks the original marked/completed review attempt and accepted dimensions, rechecks integration/provider/credential version and reservation capability, creates the next `CREATE` attempt with one database-clock timestamp for `startedAt`/`leaseStartedAt`/`providerRequestStartedAt`, copies the complete bounded accepted decision into `HospitalitySupplierReservationReviewAcceptanceHistory`, binds that history to the original review sequence and consumed Create sequence, moves the operation to `SUBMITTING`, clears every active acceptance field, and records `supplier.reservation-reviewed-provider-request-started` without provider payloads, traveler PII, or card data.

The history table has tenant/reservation-scoped uniqueness for review sequence, consumed Create sequence, and acceptance fingerprint. Its consumed attempt is a database foreign key to the exact reservation attempt, and the consumed sequence must be exactly the review sequence plus one.

Only after that transaction commits does the executor issue the external POST. If deterministic request/card work, source acquisition, or OAuth fails first, no new attempt exists and the accepted decision remains available. If the transaction commits, the acceptance is single-use: transport uncertainty follows the existing `AMBIGUOUS`/recovery path, and even a definitive provider failure is persisted non-retryable rather than allowing normal submission to omit or silently reuse the reviewed flags.

The reviewed executor adds only accepted query flags whose durable decision value is `true`. The initial Create method never sends either flag. If the second provider response reports another price and/or guarantee change, settlement creates a new `REVIEW_REQUIRED` cycle while prior accepted evidence remains immutable history.

## What remains closed

The one-time accepted-review second-write infrastructure and explicit payment-source contract are implemented, but Travelport `reservation` remains deliberately unadvertised and product-unreachable.

Activation still requires:

- a concrete reviewed PCI-safe FormOfPayment/guarantee source appropriate for the provisioned Travelport account;
- live non-production SearchComplete -> Rules -> Availability -> initial Create -> reviewed second Create -> Sync/recovery verification;
- authoritative `13034` and locator-less correlation/retry semantics with Travelport/provider evidence; and
- complete product/API states only after those commercial-write/payment/recovery gates pass.

Normal retry must never be able to reach the reviewed second-sell path.

## Provider references

Travelport's current Create Reservation reference/full-payload documentation states that `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` are Boolean query parameters for the second request only after a price or guarantee change prevents the first sell. Travelport's Stays guide likewise states not to send either parameter on the first reservation request.
