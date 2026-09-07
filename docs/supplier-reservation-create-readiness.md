# Supplier Reservation Create Readiness

SF keeps the Travelport reservation capability closed until the remaining payment, recovery, and live-validation gates are complete. A real single-room Create Reservation executor and server-only create coordinator now exist, but neither is reachable from product UX while the reviewed PCI-safe form-of-payment strategy and provider validation are unresolved. The submission-authority boundary remains intentionally stricter than general read-only Rules display because it decides whether an external commercial write may be claimed.

## Fresh commercial consistency

Immediately before a create, SF repeats the selected-offer Rules and Availability authority checks and derives non-secret payment authority only from fresh normalized evidence.

The decisive guarantee instruction and normalized payment timing must agree. `PREPAY_REQUIRED` and `DEPOSIT_REQUIRED` are accepted only with `PREPAY`; `GUARANTEE_REQUIRED` is accepted only with `POSTPAY`. `UNKNOWN` or contradictory payment timing fails closed before the create claim. This is a consistency check, not a provider retry rule.

Travelport documents `RatePaymentInfo` as `PrePay`, `PostPay`, or `Unknown`. Its Create Reservation contract states that prepay and deposit amounts are charged at booking, while guarantee-required amounts are expected at check-in. SF therefore does not infer a writable payment instruction from contradictory Rules evidence.

The existing payment-authority checks remain in force: exactly one decisive guarantee type, no contradictory guarantee flags, at least one bounded accepted-card code, and for deposits exactly one positive same-currency deposit amount not exceeding the accepted reservation total.

## Loyalty-required rates

Travelport Rules documents `CustomerLoyaltyIDRequiredAtReservation=true` as meaning the rate is contingent on a membership number included in the reservation request.

SF does not yet bind an authorized traveler loyalty identifier into the durable reservation payload authority. The create submission gate therefore requires `customerLoyaltyRequiredAtReservation` to be explicitly `false`. `true` and unknown/null both fail closed before the external-write claim. A future loyalty-capable create flow must add an authorized traveler-owned loyalty boundary and include it in the reservation payload fingerprint rather than taking an unbound value from browser input.

`RateQualificationIDRequiredAtCheckIn` is different: Travelport describes it as proof presented at the property. SF does not reinterpret that flag as a Create Reservation payload requirement, although it remains part of normalized Rules evidence shown to the reservation review flow.

## Provider-specific non-secret request material

After fresh submission authority and traveler re-binding succeed, SF builds the provider-specific non-secret portion of the Travelport v11 Create Reservation request **before** claiming the durable external write. The material contains only:

- the freshly revalidated Availability `CatalogOfferingIdentifier`;
- one canonical primary `Traveler` with Travelport name, telephone, and email fields; and
- one exact `Payment` instruction derived from the fresh payment authority, using SF's integer-minor money conversion and the correct deposit/guarantee indicators.

Travelport+ documents a 22-character combined limit for traveler `Given` plus `Surname` and says longer names are truncated in the response. SF rejects an over-limit name before the create claim instead of allowing the provider to change the identity evidence through truncation.

The request material is ephemeral server-only data. It must not be persisted or audited and it is not a complete Create Reservation request. In particular, it does not include `FormOfPayment`, `PaymentCard`, card number, CVV/security code, cardholder, billing-card data, provider credentials, or access tokens.

## Server-only Travelport Create executor

The provider adapter has a real fixed-endpoint v11 Create Reservation executor for the documented reference-payload workflow. It composes `ReservationQueryBuild` from the freshly built non-secret request material plus one sensitive payment-card value supplied only to the server adapter. It validates the card code, expiry, PAN shape, cardholder, and security-code shape and requires the card code to be present in the fresh accepted-card authority before OAuth or provider I/O. The current authority comes from Travelport Rules `AcceptedCreditCard`, so this first write path accepts only `CardType=Credit`; Travelport's generic `Debit`/`Gift` payload values remain unsupported until fresh supplier authority can prove those payment types.

This executor is intentionally **not** a card-collection strategy. No route, browser form, public action, persistence model, audit payload, or log sink accepts the sensitive payment-card input. The executor does not make raw PAN/CVV storage acceptable and does not make the application PCI-ready. The remaining product decision is where the sensitive form of payment comes from under the reviewed PCI scope for the actually provisioned Travelport commercial account.

Request composition and OAuth finish before the durable commercial-write marker. The executor then invokes the supplied callback immediately before the POST and only sends `POST /11/hotel/book/reservations/build` after that callback succeeds. A token/authentication failure or card-authority failure therefore happens before provider-write ambiguity is established; network uncertainty after the marker is returned as `AMBIGUOUS` and must not cause a blind re-sell.

The initial sell never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`. Existing response classification owns confirmed, review-required, Booking.com Sync-required, and unknown/malformed outcomes. The integration loader constructs the executor behind the existing encrypted credential boundary and shared trace transport, but the provider still does not advertise the `reservation` capability.

## Authorized create coordinator

`createTravelportStaysReservationWithSensitivePaymentCard` now connects the fresh authority gate, durable create claim, exact current integration/credential version, Travelport executor, provider-request marker, normalized create-outcome bridge, and durable settlement ledger.

The coordinator repeats the exact integration identity and credential version after the claim so a configuration rotation cannot silently switch credentials between review and commercial execution. It reconstructs the expected Travelport property/stay/occupancy receipt identity from durable operation evidence, using the same provider-specific property decoder as known-locator recovery.

Pre-provider failures are settled immediately as retry-safe `FAILED` attempts because the commercial provider-request marker was never crossed. A later retry must still repeat fresh authority. After the marker, any unexpected execution uncertainty is conservatively `AMBIGUOUS / INVALID_RESPONSE`; normal results are settled through the existing confirmed/review/ambiguous mapping. A settlement failure after provider execution remains protected by the durable marker and stale-attempt recovery.

Create observability is allowlisted to timestamp, operation/tenant/correlation identifiers, normalized result, and duration. It does not log traveler, card, locator, supplier confirmation, provider payload, credential, or token data.

The coordinator is server infrastructure only. There is still no route/action or product control that can provide its sensitive payment-card parameter, and it does not establish a PCI-safe source for that material. See `docs/travelport-reservation-create-coordinator.md`.

## Secrets and provider ownership

Fresh payment authority contains only commercial instruction metadata: kind, collection timing, currency, amount, and bounded accepted-card codes. It must not contain PAN, CVV/security code, billing-card plaintext, access tokens, provider credentials, or raw provider payloads.

The fresh Travelport provider submission reference remains ephemeral and adapter-owned. It is carried only from the freshly revalidated Availability authority into the server-only write coordinator and is not persisted, audited, logged, or accepted from the browser.

Travelport's documented reference Create Reservation request requires `FormOfPayment` with payment-card data. Public Travelport Stays documentation includes plaintext card-number fields and makes CVV mandatory for certain suppliers, including Booking.com. SF therefore does not claim a PCI-safe implementation merely because the provider adapter and coordinator can compose and send that sensitive payload. The source/collection/handling boundary for form of payment must be reviewed for the actually provisioned commercial account before any reachable caller can supply it to the coordinator.

## Capability gate

Travelport `reservation` capability remains disabled. The fresh-authority checks, non-secret request mapping, server-only HTTP executor, and create coordinator remove the core request/orchestration dependencies but do not make the integration write-ready by themselves. Enabling reservation still requires the reviewed PCI-safe form-of-payment source/handling approach, explicit authorized price/guarantee-change decisions, safe locator-less/Booking.com Sync recovery, authoritative negative/correlation semantics, and live non-production validation.

References:

- Travelport Hotel Rules reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Travelport Hotel Availability: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
