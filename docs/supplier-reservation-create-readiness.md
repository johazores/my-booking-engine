# Supplier Reservation Create Readiness

SF keeps the Travelport reservation capability closed until a real single-room Create Reservation executor and a reviewed PCI-safe form-of-payment strategy are available. The current submission-authority boundary is intentionally stricter than general read-only Rules display because it decides whether an external commercial write may be claimed.

## Fresh commercial consistency

Immediately before a future create, SF repeats the selected-offer Rules and Availability authority checks and derives non-secret payment authority only from fresh normalized evidence.

The decisive guarantee instruction and normalized payment timing must agree. `PREPAY_REQUIRED` and `DEPOSIT_REQUIRED` are accepted only with `PREPAY`; `GUARANTEE_REQUIRED` is accepted only with `POSTPAY`. `UNKNOWN` or contradictory payment timing fails closed before the create claim. This is a consistency check, not a provider retry rule.

Travelport documents `RatePaymentInfo` as `PrePay`, `PostPay`, or `Unknown`. Its Create Reservation contract states that prepay and deposit amounts are charged at booking, while guarantee-required amounts are expected at check-in. SF therefore does not infer a writable payment instruction from contradictory Rules evidence.

The existing payment-authority checks remain in force: exactly one decisive guarantee type, no contradictory guarantee flags, at least one bounded accepted-card code, and for deposits exactly one positive same-currency deposit amount not exceeding the accepted reservation total.

## Loyalty-required rates

Travelport Rules documents `CustomerLoyaltyIDRequiredAtReservation=true` as meaning the rate is contingent on a membership number included in the reservation request.

SF does not yet bind an authorized traveler loyalty identifier into the durable reservation payload authority. The create submission gate therefore requires `customerLoyaltyRequiredAtReservation` to be explicitly `false`. `true` and unknown/null both fail closed before the external-write claim. A future loyalty-capable create flow must add an authorized traveler-owned loyalty boundary and include it in the reservation payload fingerprint rather than taking an unbound value from browser input.

`RateQualificationIDRequiredAtCheckIn` is different: Travelport describes it as proof presented at the property. SF does not reinterpret that flag as a Create Reservation payload requirement, although it remains part of normalized Rules evidence shown to the reservation review flow.

## Secrets and provider ownership

Fresh payment authority contains only commercial instruction metadata: kind, collection timing, currency, amount, and bounded accepted-card codes. It must not contain PAN, CVV/security code, billing-card plaintext, access tokens, provider credentials, or raw provider payloads.

The fresh Travelport provider submission reference remains ephemeral and adapter-owned. It is carried only from the freshly revalidated Availability authority into the future write coordinator and is not persisted, audited, logged, or accepted from the browser.

## Capability gate

Travelport `reservation` capability remains disabled. These checks harden pre-create authority but do not make the integration write-ready by themselves. Enabling reservation still requires the reviewed PCI-safe form-of-payment approach, the actual provider create coordinator/adapter, explicit price/guarantee-change decisions, safe ambiguity recovery, and live non-production validation.

References:

- Travelport Hotel Rules reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Travelport Hotel Availability: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Travelport Create Reservation reference payload: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
