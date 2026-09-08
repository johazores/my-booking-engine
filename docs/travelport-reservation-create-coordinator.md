# Travelport Reservation Create Coordinator

## Purpose

SF has server-only orchestration for the implemented Travelport v11 single-room Create Reservation path. It connects fresh commercial authority, tenant-scoped authorization, the durable supplier reservation attempt ledger, the Travelport executor, conservative response classification, commercial-review handling, and durable settlement.

Travelport `reservation` remains disabled in the configured capability list. No browser route, staff action, customer action, or public API can invoke either Create coordinator.

The coordinator is **not a card-collection surface**. Raw card data is not part of the ordinary coordinator request object. Instead, the initial and reviewed Create coordinators pass a deferred `TravelportStaysReservationPaymentCardSource` server capability into the provider executor. That capability receives only bounded non-sensitive tenant/reservation/integration/attempt context and returns one ephemeral card only when the executor asks for it. The repository does not provide a concrete production implementation of that source yet, so this narrows the PCI boundary without claiming SF is PCI-ready.

## Initial Create execution sequence

`createTravelportStaysReservationWithSensitivePaymentCard` uses the authoritative submission gate first. That gate performs server-side `availability:read`, `pricing:read`, and `booking:manage` authorization, tenant-scoped operation lookup, traveler fingerprint re-binding, current Rules/Availability review, exact request-fingerprint-v2 re-binding, current sell-reference validation, fresh non-secret payment authority derivation, and the durable Create claim.

After the claim, the coordinator reloads the active Travelport integration and requires the exact integration ID, provider code, credential version, and `reservation` capability bound to the durable operation. It reconstructs expected provider receipt identity from durable property/stay/occupancy evidence.

The coordinator does not acquire a card at that point. It passes a deferred callback containing the exact organization, reservation, integration, credential version, attempt, and `INITIAL_CREATE` purpose to the Travelport executor. Every identifier in that context must be a valid UUID.

Inside the executor, non-secret expected-reservation/payment authority and reviewed query state are validated first. Travelport OAuth completes before the payment-card source is invoked. Only after successful authentication does the executor obtain the ephemeral card, validate the freshly accepted card code, cardholder/PAN/security-code shape, expiry through the durable stay, and bounded optional billing-address/payment-telephone material, compose and serialize the final request, and invoke its protected provider-request callback.

That callback records `providerRequestStartedAt` on the exact current attempt. Only then may the commercial POST begin. An OAuth failure therefore never obtains PAN/CVV, and card material exists only in the final pre-POST window.

## Failure and review semantics

Failures before the durable provider-request marker cannot have crossed the protected sell boundary, but retryability still comes only from the provider-neutral pre-provider classifier. Only `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT` can be retryable; authentication, invalid request/response authority, integration drift, payment-source/configuration failure, and unexpected application errors are non-retryable unless an explicit classifier says otherwise. Every later submission repeats fresh authority.

If the executor returns a commercial outcome without invoking its protected callback, the coordinator records conservative provider-request evidence and settles `AMBIGUOUS / INVALID_RESPONSE`. Once the marker exists, transport or unexpected uncertainty is never downgraded to a blind retry.

Price and/or guarantee changes persist as `REVIEW_REQUIRED` with one fixed reason: `SUPPLIER_PRICE_CHANGED`, `SUPPLIER_GUARANTEE_CHANGED`, or `SUPPLIER_PRICE_AND_GUARANTEE_CHANGED`. Normal retry cannot consume that state. The initial Create request never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`.

The separately authorized price/guarantee-change acceptance path is implemented. `acceptTravelportStaysReservationCommercialReview` records a bounded actor-bound decision only after fresh tenant, traveler, integration, offer, Rules, Availability, and payment-authority verification. `reviewTravelportStaysReservationAcceptedCommercialAuthority` then performs the read-only fresh-authority gate immediately before one-time consumption.

## Reviewed second Create

`createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard` is separate from normal submission and retry. It revalidates accepted commercial authority, rebuilds current request material, reloads the exact integration, and passes a deferred source callback with purpose `REVIEW_ACCEPTANCE_CREATE` to the reviewed executor.

The reviewed executor validates non-secret authority and the exact accepted query flags, then completes OAuth before invoking the payment-card source. After authentication it validates and serializes the ephemeral form-of-payment request. Only then does its provider-request callback run `consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest` under the tenant-scoped operation advisory lock.

The serializable transaction reconstructs the exact accepted decision, verifies the original review attempt and integration authority, creates exactly one next `CREATE` attempt, archives immutable acceptance history, clears the active acceptance slot, moves the operation to `SUBMITTING`, and records the provider-request marker immediately before the POST.

If deterministic work, OAuth, payment-source acquisition, or card validation fails before consumption, no second Create attempt exists and the accepted decision remains unconsumed. After consumption, the decision is single-use. Transport uncertainty follows the ambiguous/recovery path, and a definitive provider failure is forced non-retryable so normal Create cannot omit or silently reuse the accepted flags. A new provider price/guarantee change creates a new `REVIEW_REQUIRED` cycle.

## Payment source and PCI boundary

`TravelportStaysReservationPaymentCardSource` is an internal capability boundary, not a payment product. Its context contains only organization ID, reservation ID, integration ID, integration credential version, attempt ID, and fixed purpose. The four IDs must be valid UUIDs. The context contains no PAN, CVV/security code, cardholder, billing address, payment telephone, provider credentials, access token, or provider payload.

The source contract validates its non-sensitive execution context and fails closed when the source is unavailable or returns no usable card object. Card details are still validated by the provider adapter against fresh Travelport payment authority.

No concrete PCI-reviewed source, hosted-field integration, token vault integration, collection route, persistence model, or browser form is implemented here. A future production source must be reviewed for the provisioned Travelport commercial account and must keep PAN/CVV out of Prisma, audit metadata, logs, queues, analytics, request fingerprints, and ordinary application/API payloads.

## Privacy and observability

Create provider observations are strict allowlists containing timestamp, SF attempt correlation UUID, organization UUID, fixed provider/operation names, normalized outcome, and duration. They exclude traveler data, supplier confirmations, provider locators, offer references, request/response bodies, credentials, tokens, and all form-of-payment data.

The supplier ledger and review-acceptance history store bounded commercial/recovery authority only. They never store raw card data.

## Remaining activation boundary

Travelport `reservation` remains disabled. The source **contract** is explicit and the sensitive lifetime is minimized, but production activation still requires:

- a concrete reviewed PCI-safe FormOfPayment/guarantee source appropriate for the provisioned Travelport account;
- live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery verification;
- live verification of price/guarantee second-sell behavior using only the explicitly accepted query flags;
- authoritative Travelport/provider evidence for `13034` and locator-less correlation/retry semantics; and
- product/API states only after those commercial-write, payment, and recovery gates pass.

See also:

- `docs/supplier-reservation-submission-authority.md`
- `docs/supplier-reservation-create-readiness.md`
- `docs/supplier-reservation-attempt-recovery.md`
- `docs/supplier-reservation-review-acceptance.md`
- `docs/travelport-stays-integration.md`
