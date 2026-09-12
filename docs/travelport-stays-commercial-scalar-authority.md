# Travelport Stays commercial scalar authority

## Purpose

Travelport SearchComplete and Rules responses include scalar fields that SF converts into provider-neutral offer and booking-term authority. Several of those values enter durable fingerprints or reservation-review decisions. A malformed or unsupported provider value must therefore not gain meaning by being silently normalized to `null`, `UNKNOWN`, or another compatibility fallback.

This boundary extends the existing commercial structural authority. It strengthens the active SearchComplete → pricing → Rules review chain only and does not advertise the Travelport `reservation` capability.

## SearchComplete authority

Travelport's current SearchComplete contract documents `terms.refundable`, `paymentTypeEstimated`, `freeCancellationWithin24Hours`, `customerLoyaltyIDRequiredAtReservation`, and `rateQualificationIDRequiredAtCheckIn` as booleans. It also documents exact supported values for commercial enums:

- `priceChangeProbability`: `High`, `Medium`, `Low`;
- `terms.ratePaymentInfo`: `PrePay`, `PostPay`, `Unknown`; and
- `terms.guaranteeType`: `GuaranteeRequired`, `NoGuaranteesAccepted`, `DepositRequired`, `PrepayRequired`.

SF validates those enums before the compatibility parser can turn unsupported values into provider-neutral `UNKNOWN`. The same fail-closed boolean rule is applied to the SearchComplete booleans already consumed by offer authority and fingerprints, including inclusion flags and price indicators such as `taxesIncludedInBase`, `resortFeeIncluded`, and `predictedPriceChangeDuringStay`. Cancellation `estimatedDeadlineLocal` and penalty `estimatedAmount` remain boolean authority as well.

The provider's documented `Unknown` payment timing is still valid authority and remains distinct from an undocumented value. Whitespace, case changes, future/unknown enum strings, or other normalization-confusable values are rejected instead of being promoted through compatibility fallbacks.

Optional values may still be omitted or explicitly `null`. This does not make optional evidence mandatory; it only preserves the distinction between absent evidence and malformed present evidence.

## Rules authority

Travelport's current hotel Rules model documents `CustomerLoyaltyIDRequiredAtReservation` and `RateQualificationIDRequiredAtCheckIn` as booleans. For `HotelPenaltyNights`, `subjectToTax` is explicitly `Yes`, `No`, or `Unknown`. Cancellation `Refundable` is represented as `Yes` / `No` in the current hotel contract. Deposit `remainderInd` is boolean. Cancellation specific dates and deposit dates use `YYYY-MM-DD`, and deadline/check-in/check-out times use local 24-hour time values.

Before Rules normalization and fingerprinting, SF now requires:

- present nights-penalty `subjectToTax` to be exactly `Yes`, `No`, or `Unknown`;
- present loyalty/qualification indicators to be booleans;
- present cancellation refundability to be boolean or exact `Yes` / `No`, matching the existing compatibility parser;
- present cancellation `Deadline`, nested `SpecificDate`, and `CheckInOutPolicy` values to have object shape;
- present specific/start/end and deposit dates to be calendar-valid `YYYY-MM-DD` values;
- present deadline/check-in/check-out time values to be valid 24-hour `HH:MM` or `HH:MM:SS` values; and
- present deposit `remainderInd` values to be boolean.

Empty optional date/time strings remain compatible with the existing parser's missing-value behavior. Other malformed present scalar evidence fails with `INVALID_RESPONSE` before it can be collapsed into missing or unknown authority.

## Similar-issue sweep

The sweep covered the scalar values consumed by the two compatibility cores in the same commercial path:

- SearchComplete offer price, inclusions, terms, cancellation estimates, probability, payment-timing, and guarantee fields;
- Rules nights-penalty tax treatment, loyalty/qualification, cancellation/refundability/deadline, deposit, and check-in/out policy fields.

The sweep also reviewed Rules payment timing and guarantee normalization. Existing repository behavior deliberately preserves an unrecognized Rules guarantee as provider-neutral `UNKNOWN` while marking the terms incomplete for reservation review. This run keeps that safety contract instead of converting it into a transport failure. The new closed-enum enforcement is therefore limited to SearchComplete fields whose current Travelport contract publishes an explicit finite response set, plus Rules `subjectToTax`, whose `Yes` / `No` / `Unknown` states are explicitly documented.

Provider presentation-only values and reservation response models were not broadened into this change. Reservation Create/Sync/recovery already use their separately reviewed response-evidence contracts, while Travelport reservation activation remains gated independently.

## Validation

Focused behavior coverage verifies canonical SearchComplete and Rules scalar evidence, malformed booleans, normalization-confusable machine strings, unsupported documented-enum values, explicitly documented `Unknown` states, invalid refundability, invalid calendar dates, invalid 24-hour times, malformed deadline structure, deposit indicators, and absence/null compatibility.

A dependency-free source contract pins the exact provider enum allowlists and the public commercial guard so a future compatibility-core refactor cannot silently remove these checks. The focused authority module and test file also pass Node TypeScript strip/check validation in the available local runtime.

Full repository `npm run validate`, Prisma/PostgreSQL execution, and production build still require the repository-supported Node 24.20+ dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Activation boundary

This change does not provide a FormOfPayment/guarantee source or enable supplier reservation writes. Travelport `reservation` remains deliberately unadvertised pending:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live `13034` and locator-less correlation/retry semantics.

## Travelport references

- SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm
- Hotel Rules Reference Payload API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- Hotel Availability API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Availability.htm
- Hotel Industry Terms & Processes Guide: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/OtherGuides/HotelTermsGuide.htm

## Related SF contracts

- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-stays-transport-token-authority.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
