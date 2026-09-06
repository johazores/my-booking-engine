# Supplier Reservation Create Readiness

SF keeps the Travelport reservation capability closed until a real single-room Create Reservation coordinator and a reviewed PCI-safe form-of-payment strategy are available. The current submission-authority boundary is intentionally stricter than general read-only Rules display because it decides whether an external commercial write may be claimed.

## Fresh commercial consistency

Immediately before a future create, SF repeats the selected-offer Rules and Availability authority checks and derives non-secret payment authority only from fresh normalized evidence.

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

The provider adapter now has a real fixed-endpoint v11 Create Reservation executor for the documented reference-payload workflow. It composes `ReservationQueryBuild` from the freshly built non-secret request material plus one sensitive payment-card value supplied only to the server adapter. It validates the card code, expiry, PAN shape, cardholder, and security-code shape and requires the card code to be present in the fresh accepted-card authority before OAuth or provider I/O. The current authority comes from Travelport Rules `AcceptedCreditCard`, so this first write path accepts only `CardType=Credit`; Travelport's generic `Debit`/`Gift` payload values remain unsupported until fresh supplier authority can prove those payment types.

This executor is intentionally **not** a card-collection strategy. No route, browser form, public action, persistence model, audit payload, or log sink accepts the sensitive payment-card input. The executor does not make raw PAN/CVV storage acceptable and does not make the application PCI-ready. The remaining product decision is where the sensitive form of payment comes from under the reviewed PCI scope for the actually provisioned Travelport commercial account.

The execution ordering is fail-closed around the durable write ledger. Request composition and OAuth finish first. A future coordinator must then mark the existing durable reservation attempt as provider-request-started through the supplied callback immediately before the POST. Only after that marker succeeds does the executor send `POST /11/hotel/book/reservations/build`. A token/authentication failure or card-authority failure therefore happens before provider-write ambiguity is established; network uncertainty after the marker is returned as `AMBIGUOUS` and must not cause a blind re-sell.

The initial sell never sends `acceptPriceChangeInd` or `acceptGuaranteeChangeInd`. Existing response classification still owns confirmed, review-required, Booking.com Sync-required, and unknown/malformed outcomes. The integration loader constructs the executor behind the existing encrypted credential boundary and shared trace transport, but the provider still does not advertise the `reservation` capability.

## Secrets and provider ownership

Fresh payment authority contains only commercial instruction metadata: kind, collection timing, currency, amount, and bounded accepted-card codes. It must not contain PAN, CVV/security code, billing-card plaintext, access tokens, provider credentials, or raw provider payloads.

The fresh Travelport provider submission reference remains ephemeral and adapter-owned. It is carried only from the freshly revalidated Availability authority into the future write coordinator and is not persisted, audited, logged, or accepted from the browser.

Travelport's documented reference Create Reservation request requires `FormOfPayment` with payment-card data. Public Travelport Stays documentation includes plaintext card-number fields and makes CVV mandatory for certain suppliers, including Booking.com. SF therefore does not claim a PCI-safe implementation merely because the provider adapter can now compose and send that sensitive payload. The source/collection/handling boundary for form of payment must be reviewed for the actually provisioned commercial account before any caller can supply it to the executor.

## Capability gate

Travelport `reservation` capability remains disabled. The fresh-authority checks, non-secret request mapping, and server-only HTTP executor remove the raw Travelport POST/composition dependency but do not make the integration write-ready by themselves. Enabling reservation still requires the reviewed PCI-safe form-of-payment source/handling approach, an authorized coordinator that connects the executor to the existing durable marker and settlement ledger, explicit price/guarantee-change decisions, safe ambiguity recovery, and live non-production validation.

References:

- Travelport Hotel Rules reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Travelport Hotel Availability: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
