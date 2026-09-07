# Supplier reservation commercial-review acceptance

## Purpose

Travelport can reject an initial hotel sell with a definitive no-sell price and/or guarantee change. SF persists those outcomes as `REVIEW_REQUIRED`. This document defines the implemented acceptance-decision boundary. It does not enable a second supplier write, expose reservation UX, collect card data, or advertise the Travelport `reservation` capability.

Travelport documents `acceptPriceChangeInd=true` and `acceptGuaranteeChangeInd=true` as second-request query parameters. They must not be sent on the initial Create Reservation request. An SF acceptance decision therefore remains separate from normal retry authority.

## Authorization and tenant scope

`acceptTravelportStaysReservationCommercialReview` is server-only. Before loading provider credentials it requires:

- `availability:read`;
- `pricing:read`; and
- `booking:manage`.

The reservation operation is then loaded with both operation ID and organization ID. The workflow accepts only the current single-room `travelport-stays` `REVIEW_REQUIRED` operation with request-fingerprint version 2 and one of the three fixed review reasons.

The actor must explicitly accept exactly the pending dimensions:

- `SUPPLIER_PRICE_CHANGED` -> price only;
- `SUPPLIER_GUARANTEE_CHANGED` -> guarantee only; or
- `SUPPLIER_PRICE_AND_GUARANTEE_CHANGED` -> both.

Partial acceptance of a combined change and acceptance of an unrelated dimension fail closed.

## Durable provider-write evidence

`REVIEW_REQUIRED` on the operation row is not sufficient by itself to authorize a commercial decision. Before any Travelport credentials are loaded, SF also requires the current durable `CREATE` attempt to match the operation attempt count, be settled as `REVIEW_REQUIRED`, carry the same normalized review reason, and contain both the durable provider-request marker and a valid completion timestamp. The review settlement records that completion time from the PostgreSQL clock after the provider marker has already been persisted.

This prevents an inconsistent, stale, manually altered, or partially persisted operation row from becoming acceptance authority. After fresh supplier authority is reviewed, the same attempt is rechecked under the operation advisory lock before any acceptance fields are persisted. The exact attempt record must still be the one that produced the pending review.

## Fresh authority before durable acceptance

The previous failed sell is not commercial authority for a later decision. Before the decision is persisted, SF:

1. rebinds the primary traveler to the existing durable traveler fingerprint;
2. requires the same active tenant integration, provider code, credential version, and `reservation` capability;
3. revalidates the selected offer with real-time SearchComplete pricing;
4. requires the current price-change condition to match the pending decision (price must differ only when price acceptance is required);
5. retrieves fresh Rules against the current offer price/fingerprint;
6. requires complete reservation-review terms and a supported customer-loyalty boundary;
7. repeats the reservation-authority adapter, which re-runs fresh SearchComplete, Rules, and bounded Availability matching; and
8. derives a supported current payment/guarantee authority.

Any provider drift, unavailable offer, unrelated price change, incomplete Rules, unsupported payment authority, integration rotation, traveler change, attempt mismatch, or authority race prevents acceptance.

The expiring Travelport `CatalogOfferingIdentifier` is deliberately not persisted as acceptance authority. A future second-write coordinator must perform another immediate fresh authority review and prove it matches the durable accepted fingerprints before it can claim a write.

## Durable decision

The supplier reservation operation remains `REVIEW_REQUIRED`; normal submission therefore stays blocked.

An accepted decision persists only bounded non-secret commercial evidence:

- actor user ID and acceptance time;
- current review attempt sequence;
- the exact accepted dimensions;
- currency and exact accepted total in integer minor units;
- current offer, Rules-terms, and Availability-authority fingerprints; and
- a versioned acceptance fingerprint binding those values to the reservation ID, accepting actor, review reason, attempt, and immutable traveler payload fingerprint.

The acceptance fields are all-null or all-present under a database check constraint. When present, the operation must still be `REVIEW_REQUIRED`, the accepted dimensions must match the fixed review reason, accepted currency must match the operation currency, and the accepted attempt sequence must equal the current attempt count.

The audit event `supplier.reservation-review-accepted` contains only bounded commercial metadata and the acceptance fingerprint. It does not contain provider payloads, traveler PII, PAN, CVV, cardholder details, credentials, or the expiring provider submission reference.

## What remains closed

This slice records a safe explicit actor decision and proves fresh supplier authority, but it intentionally does not consume that decision into a second Create Reservation attempt.

Before any second provider write is enabled, SF still needs a dedicated claim/consumption boundary that:

- re-runs fresh offer -> Rules -> Availability authority and matches the durable acceptance fingerprint inputs;
- rebinds traveler and current payment authority;
- atomically consumes exactly one accepted review decision into exactly one durable provider-write attempt;
- sends only the applicable documented Travelport acceptance query parameter(s);
- preserves the existing provider-request marker, ambiguity, recovery, and settlement rules; and
- cannot be reached through normal retry.

The PCI-safe FormOfPayment source/handling strategy, live Travelport non-production validation, and authoritative locator-less/`13034` recovery semantics remain separate activation blockers.

## Provider references

Travelport's current Create Reservation reference/full-payload documentation states that `acceptPriceChangeInd` and `acceptGuaranteeChangeInd` are Boolean query parameters for the second request only after a price or guarantee change prevents the first sell. Travelport's Stays guide likewise states not to send either parameter on the first reservation request.
