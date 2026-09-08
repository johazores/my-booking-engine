# Supplier Reservation Create Readiness

SF keeps the Travelport reservation capability closed until the remaining payment, recovery, and live-validation gates are complete. A real single-room Create Reservation executor, initial create coordinator, commercial-review decision path, and one-time reviewed second-Create path now exist, but none is reachable from product UX while the concrete reviewed PCI-safe form-of-payment source and provider validation are unresolved.

## Fresh commercial consistency

Immediately before a create, SF repeats the selected-offer Rules and Availability authority checks and derives non-secret payment authority only from fresh normalized evidence.

The decisive guarantee instruction and normalized payment timing must agree. `PREPAY_REQUIRED` and `DEPOSIT_REQUIRED` are accepted only with `PREPAY`; `GUARANTEE_REQUIRED` is accepted only with `POSTPAY`. `UNKNOWN` or contradictory payment timing fails closed before the create claim.

The existing payment-authority checks remain in force: exactly one decisive guarantee type, no contradictory guarantee flags, at least one bounded accepted-card code, and for deposits exactly one positive same-currency deposit amount not exceeding the accepted reservation total.

## Loyalty-required rates

Travelport Rules documents `CustomerLoyaltyIDRequiredAtReservation=true` as meaning the rate is contingent on a membership number included in the reservation request.

SF does not yet bind an authorized traveler loyalty identifier into durable reservation payload authority. The create submission gate therefore requires `customerLoyaltyRequiredAtReservation` to be explicitly `false`. `true` and unknown/null both fail closed before the external-write claim. A future loyalty-capable flow must add an authorized traveler-owned loyalty boundary and include it in the reservation payload fingerprint rather than taking an unbound browser value.

## Provider-specific non-secret request material

After fresh submission authority and traveler re-binding succeed, SF builds the provider-specific non-secret portion of the Travelport v11 Create Reservation request before claiming the durable external write. The material contains only the freshly revalidated Availability `CatalogOfferingIdentifier`, one canonical primary `Traveler`, and one exact `Payment` instruction derived from fresh payment authority.

The request material is ephemeral server-only data. It does not include `FormOfPayment`, `PaymentCard`, card number, CVV/security code, cardholder, billing-card data, provider credentials, or access tokens.

## Server-only Travelport Create executor

The provider adapter has a fixed-endpoint v11 Create Reservation executor for the documented reference-payload workflow. Before asking for sensitive form-of-payment, it validates the non-secret reservation/payment authority and reviewed query selection and completes Travelport OAuth. OAuth therefore completes before the payment-card source is invoked. Only after OAuth succeeds does the executor validate the returned card, compose and serialize the final request, record the durable provider-request marker, and start the POST.

This ordering keeps PAN/CVV out of the authentication/retry window and means an OAuth failure never asks the external payment-card source for card material. The final card checks include the freshly accepted one-to-two-character provider card code, credit-card type, cardholder/PAN/security-code shape, expiry through the reservation departure date, and bounded optional billing address and telephone details.

The initial Create never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`. The reviewed second Create sends only the accepted `true` flag or flags after a durable commercial-review decision has been freshly revalidated and atomically consumed.

The executor is intentionally not a card-collection strategy. Raw PAN/CVV storage is not made acceptable by the adapter, and no public route or browser form is authorized to pass raw card data into ordinary SF request payloads.

## Explicit ephemeral payment-card source contract

Raw card data is not part of the initial or reviewed coordinator request objects. Both coordinators provide a deferred `TravelportStaysReservationPaymentCardSource` server capability to the provider executor rather than acquiring a card before provider authentication.

The source receives only:

- organization ID;
- reservation ID;
- exact Travelport integration ID;
- exact integration credential version;
- exact reservation attempt ID; and
- a fixed purpose of `INITIAL_CREATE` or `REVIEW_ACCEPTANCE_CREATE`.

Every identifier in this sensitive-source context must be a valid UUID. `acquireTravelportStaysReservationPaymentCard` also validates the credential version and fixed purpose and fails closed when the source capability is absent, the context is malformed, or no usable card object is returned. Provider-specific card/payment validation remains inside the Travelport adapter against current Rules/Availability-derived payment authority.

For the initial Create, the source callback is not invoked until the authoritative tenant/traveler/commercial gate has claimed the exact Create attempt, the active Travelport integration identity/credential version has been rechecked, non-secret request authority is valid, and OAuth has succeeded. A source failure is therefore a pre-provider failure and cannot create supplier-write ambiguity.

For a reviewed second Create, the source callback is not invoked until the stored acceptance has been reconstructed, fresh accepted commercial authority has been revalidated, current request material has been rebuilt, the exact Travelport integration identity has been rechecked, and OAuth has succeeded. If OAuth, source acquisition, or deterministic card validation fails, no second Create attempt has been consumed and the accepted review remains available for a later authorized attempt.

This source contract narrows the sensitive-data boundary; it does **not** complete the PCI gate. The repository deliberately contains no fake vault, hosted-field flow, token exchange, collection route, or mock production payment integration. A concrete source must still be implemented/reviewed for the actually provisioned Travelport commercial account.

## Authorized create coordinator

`createTravelportStaysReservationWithSensitivePaymentCard` connects the fresh authority gate, durable create claim, exact current integration/credential version, deferred payment-card source capability, Travelport executor, provider-request marker, normalized outcome bridge, and durable settlement ledger.

Failures before the durable provider-request marker are duplicate-safe because the supplier write did not cross the protected boundary, but automatic retry still requires explicit provider-neutral retry authority. Only rate limiting, provider unavailability, and timeout are persisted as retryable. Authentication failures, invalid request/response authority, integration/configuration drift, invalid payment-source context, and unexpected application failures are non-retryable.

If an executor ever returns a commercial outcome without invoking its protected callback, the coordinator records conservative provider-request evidence and settles `AMBIGUOUS / INVALID_RESPONSE`. After the marker, unexpected execution uncertainty remains ambiguous; normal results are settled through the existing confirmed/review/ambiguous mapping.

## Commercial-review second Create

A definitive Travelport price/guarantee change becomes `REVIEW_REQUIRED`. Explicit acceptance is actor-bound and fingerprinted against the exact price/guarantee dimensions, amount/currency, offer, terms, authority, traveler, integration, and review attempt.

`createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard` repeats fresh accepted authority and delegates deferred form-of-payment acquisition to the reviewed executor. The executor completes OAuth first, then obtains and validates the ephemeral card. Its provider-request callback atomically archives the accepted decision, creates the next Create attempt, marks the provider request, and clears the active acceptance slot immediately before the second POST. Normal retry cannot reach this path.

If the second provider response reports another commercial change, a new `REVIEW_REQUIRED` cycle is created. Prior accepted evidence remains immutable history.

## Secrets and provider ownership

Fresh payment authority contains only commercial instruction metadata: kind, collection timing, currency, amount, and bounded accepted-card codes. It must not contain PAN, CVV/security code, billing-card plaintext, access tokens, provider credentials, or raw provider payloads.

The fresh Travelport provider submission reference remains ephemeral and adapter-owned. It is carried only from freshly revalidated Availability authority into the server-only write coordinator and is not persisted, audited, logged, or accepted from the browser.

Travelport's documented Create request can require `FormOfPayment` with plaintext card-number/security-code fields. SF therefore does not claim a PCI-safe implementation merely because the provider adapter can compose and send that payload or because the source interface is explicit.

## Capability gate

Travelport `reservation` remains disabled. Enabling it still requires:

- a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned Travelport account;
- live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery validation;
- live price/guarantee acceptance verification using only the explicitly accepted query flags;
- authoritative `13034` and locator-less negative/correlation/retry semantics; and
- product/API states only after those commercial-write/payment/recovery gates pass.

References:

- Travelport Hotel Rules reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Travelport Hotel Availability: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
