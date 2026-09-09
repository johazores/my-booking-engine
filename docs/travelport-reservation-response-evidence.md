# Travelport reservation response evidence

## Purpose

SF uses provider-specific response boundaries for durable Travelport Stays reservation evidence. Known-locator Hotel Retrieve uses `parseTravelportStaysReservationResponse`; Create Reservation and Booking.com Sync use the stricter commercial-write classifier in `travelport-stays-reservation-create-outcome.ts`, which also validates the returned property/stay/occupancy identity and write-specific error/warning semantics.

These boundaries do not expose a browser route, staff/customer reserve action, cancellation action, or public supplier-write API. Travelport `reservation` remains disabled until the concrete PCI-safe payment source, live-provider verification, and authoritative locator-less recovery/correlation gates are complete.

## Durable locator semantics

Travelport Stays reservation responses can contain multiple locator families. SF must not normalize all `sourceContext=Travelport` locators as the durable provider reservation reference.

A Travelport provider reservation reference is accepted only from a receipt locator with both:

- `sourceContext=Travelport`; and
- `locatorType=PNR Locator`.

A Travelport-context locator with another locator type is ignored for provider-reservation authority. It cannot confirm Create, Sync, or known-locator recovery, and it does not create false duplicate-PNR ambiguity when one valid Travelport PNR Locator is also present.

Supplier confirmation evidence is separate. `supplierConfirmationReference` is accepted only from a locator with `sourceContext=Supplier` and `locatorType=Confirmation Number`. Booking.com `Pin code`, supplier `Cancellation Number`, agency `IATA Number`, and other locator families are not relabeled under the wrong durable field.

Locator and correlation strings are bounded and must not contain line breaks. Once a receipt identifies itself as one of SF's relevant locator families, an invalid bounded locator value is contradictory evidence and fails closed; it is not discarded merely because another valid receipt exists.

## Normalized Retrieve evidence

`parseTravelportStaysReservationResponse` accepts an untrusted Travelport response body and returns only:

- exactly one Travelport PNR Locator receipt as `providerReservationReference`;
- at most one supplier Confirmation Number receipt; and
- a bounded correlation/trace identifier.

Known-locator recovery calls this parser only after the transport returned a successful HTTP response. A successful `ReservationResponse` that also carries a top-level `ErrorResponse` is contradictory provider evidence and fails closed to `INVALID_RESPONSE`; the parser never promotes the reservation half to `FOUND` while ignoring the error half.

Travelport's shared `ReservationResponse` contract can also include a `Result` object that carries warning or error evidence. SF accepts warning-only `Result` data as non-authoritative context only when the warning evidence itself is structurally safe: at most one supported `Warning`/defensive `Warnings` array may be present, the collection is bounded, and every warning contains a bounded single-line `Message`. Conflicting warning families, non-array warning containers, oversized collections, or malformed warning messages invalidate positive Retrieve authority instead of being ignored. Any non-null embedded `Result.Error` evidence (and the defensive unsupported plural `Result.Errors` shape) likewise fails closed. A valid-looking reservation, PNR, and hotel segment cannot hide contradictory or malformed embedded provider result evidence.

Receipt cardinality is evidence, not just reference uniqueness. Two Travelport PNR receipts that repeat the same locator are still ambiguous and fail closed, as do two supplier Confirmation Number receipts that repeat the same confirmation. A malformed relevant PNR or supplier-confirmation receipt also cannot be hidden beside an otherwise valid receipt. This prevents duplicated or structurally unsafe provider evidence from being silently collapsed into one durable fact.

Travelport can return multi-content reservations containing non-hospitality products. SF therefore ignores non-hospitality products for this Stays identity check, but its current single-room reservation workflow requires exactly one `ProductHospitality` segment in the response and that segment must exactly match the durable property, stay dates, room quantity, and guest count. A second, mismatched, or malformed `ProductHospitality` segment is contradictory reservation evidence and fails closed instead of being filtered away because another hotel segment matches.

Traveler data, contact details, form-of-payment fields, card data, payment payloads, comments, offer bodies, and raw provider payloads are discarded from the normalized result.

Known-locator Hotel Retrieve supplies `expectedProviderReservationReference`, so the returned Travelport PNR Locator must equal the requested locator exactly. Retrieve also rebinds property, stay dates, room quantity, and guest count to the durable reservation request.

Retrieve does not require the current supplier or Travelport receipt status to be `Confirmed`; a cancelled or historical provider record can still prove that the Travelport PNR exists. A cancelled Retrieve may therefore return `FOUND` while `supplierConfirmationReference` is null if Travelport exposes only a supplier cancellation-number locator.

Generic HTTP 404 is not treated as authoritative non-existence because the public Travelport Stays Retrieve contract does not establish that meaning. Unknown or malformed negative evidence preserves ambiguity rather than authorizing another sell.

## Create success evidence

Create Reservation does not rely on the generic Retrieve parser for commercial success. `classifyTravelportStaysReservationCreateOutcome` independently requires:

- exactly one top-level response family that agrees with the HTTP outcome class: `ReservationResponse` on 2xx or `ErrorResponse` on 4xx/5xx;
- a successful HTTP result for confirmation authority;
- no embedded `ReservationResponse.Result.Error`/`Errors` evidence;
- exactly one `ProductHospitality` segment in the response, and that segment must match the durable property, dates, room quantity, and guest count;
- exactly one confirmed receipt whose locator is `sourceContext=Travelport` and `locatorType=PNR Locator`;
- structurally valid bounded error/warning evidence; and
- confirmed supplier receipt state when a supplier confirmation is accepted.

A body containing both top-level `ReservationResponse` and `ErrorResponse`, neither envelope, an error envelope on 2xx/3xx, a reservation envelope on non-2xx, or embedded `ReservationResponse.Result` error evidence never grants success, review, definitive failure, or Sync/recovery authority. Contradictory dual-envelope bodies also do not choose one provider trace identifier as durable correlation evidence.

Commercial hotel-segment cardinality is fail-closed in the same way as locator cardinality. A valid matching hotel segment cannot hide a second mismatched or malformed `ProductHospitality` segment. Non-hospitality products may coexist in a Travelport multi-content reservation without being relabeled as Stays evidence.

Commercial locator evidence is validated before confirmation-status filtering. Any recognized Travelport PNR or supplier Confirmation Number receipt with a malformed locator value or a status other than `Confirmed` invalidates the commercial locator set. A confirmed receipt therefore cannot hide a second pending, cancelled, rejected, or malformed receipt from the same durable locator family.

A Travelport-context non-PNR locator cannot satisfy the provider-reservation requirement. Multiple confirmed PNR Locator receipts remain fail-closed ambiguity, including repeated receipts carrying the same locator.

Documented price/guarantee no-sell responses become `REVIEW_REQUIRED`. Reviewed definitive validation errors can become `FAILED`. Booking.com Sync-required conditions and unknown/malformed post-write outcomes remain `AMBIGUOUS` rather than being promoted to success or retry authority.

## Durable ledger evidence

The supplier reservation ledger persists optional provider and supplier confirmation references as tenant-scoped bounded operational evidence. These values are not written into audit metadata or structured logs.

The presence of a supplier confirmation does not prove a Travelport PNR exists and never authorizes another Create Reservation attempt. Likewise, a provider correlation identifier is troubleshooting evidence, not retry authority.

Known-locator reconciliation identity-binds both provider-truth outcomes to the durable Travelport PNR Locator. `FOUND` must return the exact requested locator before the operation can become `CONFIRMED`. A provider-neutral `NOT_FOUND` result can only be used when a provider adapter has separately verified authoritative negative semantics for that exact locator.

## Booking.com Sync recovery evidence

For the documented supplier-confirmed/no-PNR warning path, the Create classifier retains Booking.com Sync recovery authority only when the same response proves:

- exactly one `ProductHospitality` segment exists and it exactly matches the durable property/stay/occupancy request;
- exactly one confirmed supplier Confirmation Number;
- supplier source `BO`;
- one bounded matching-offer authority; and
- no Travelport PNR Locator receipt at all.

A second, mismatched, or malformed `ProductHospitality` segment prevents the response from granting Sync recovery authority even when another hotel segment matches. Non-hospitality products remain outside Stays segment authority.

An unconfirmed or malformed Travelport PNR receipt is contradictory evidence, not proof that the PNR is absent, and therefore cannot grant Sync recovery authority. A Travelport-context locator of another type is not a PNR and cannot itself grant Sync authority. The remaining required supplier/stay/offer evidence must still be complete.

The opaque `providerRecoveryReference` contains only provider-owned non-secret recovery authority. Traveler data, card data, credentials, tokens, raw request bodies, and raw response bodies are excluded.

The separate `13034` error remains ambiguous and does not invent a supplier confirmation or Sync authority. SF does not treat the error response alone as proof that either no Booking.com sell occurred or that Sync is safe.

Sync confirms only when its response proves the exact expected property/stay/occupancy, the original supplier confirmation, and exactly one confirmed Travelport PNR Locator. Because Sync reuses the Create commercial-response classifier, contradictory top-level response/error envelopes and embedded `ReservationResponse.Result` errors fail closed before the documented Sync-only missing-`locatorType` normalization can grant confirmation authority. Pre-provider deterministic failure is retryable only when no Sync provider marker exists; after the marker, uncertainty remains non-retryable `AMBIGUOUS`.

## Commercial review evidence

A definitive Travelport price and/or guarantee no-sell response is persisted as `REVIEW_REQUIRED`, not generic retryable failure. The current `CREATE` attempt must retain matching review state, normalized reason, a durable provider-request marker, and completion evidence before an acceptance can be recorded.

`acceptTravelportStaysReservationCommercialReview` is tenant-authorized and server-only. It repeats fresh offer, Rules, Availability, traveler, integration, and payment authority before persisting bounded non-secret acceptance evidence. The operation remains `REVIEW_REQUIRED`, so normal retry cannot consume that decision.

The reviewed second-Create path is implemented separately. A read-only gate first reconstructs and revalidates the accepted decision. Deterministic request composition, sensitive-card validation, accepted-query selection, and OAuth finish before `consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest` executes under the tenant operation lock. That transaction archives immutable acceptance history, binds the decision to exactly one new `CREATE` attempt, clears the active acceptance slot, moves the operation to `SUBMITTING`, and writes the provider-request marker immediately before external POST authority.

Only the exact accepted `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` values are sent on that reviewed second request. The initial Create sends neither flag. Normal retry cannot silently reuse reviewed acceptance.

## Privacy and observability

Normalized reservation evidence excludes traveler/customer PII, PAN/CVV, cardholder/billing data, credentials, tokens, request bodies, response bodies, and free-form provider error messages. Structured observations use bounded allowlists and SF-owned correlation identifiers.

## Validation

Focused tests cover top-level envelope exclusivity/HTTP-class coherence, embedded `ReservationResponse.Result` error rejection, malformed/conflicting/oversized warning evidence rejection while preserving bounded warning-only responses, PNR-locator identity, supplier locator-type semantics, exact receipt cardinality including repeated identical and malformed/unconfirmed relevant provider/supplier receipts, exact hospitality-segment cardinality including contradictory extra/malformed hotel segments while preserving non-hospitality multi-content products, known-locator exact-reference checks, unsafe locator/correlation values, Create success/ambiguity, Booking.com Sync recovery authority, review-required settlement, one-time accepted-review consumption, and privacy minimization.

Guarded PostgreSQL scenarios still require an explicitly disposable database target. Live Create, reviewed Create, Sync, negative lookup, and locator-less correlation behavior still require provisioned Travelport non-production credentials and a concrete reviewed PCI-safe form-of-payment source.

## References

- Travelport Create Reservation Reference Payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
- Travelport Sync Reservation: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Sync.htm
- Travelport Reservation Retrieve response contract: https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/Book/APIRef_ReservationRetrieve.htm
- Travelport Stays APIs Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/Guides/HotelAPIsGuide.htm
