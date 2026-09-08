# Travelport Stays create-outcome classification

## Purpose

A supplier reservation POST is a commercial write. Once SF crosses the provider boundary, an HTTP or payload failure is not automatically evidence that no hotel was sold. `classifyTravelportStaysReservationCreateOutcome` therefore converts only bounded, reviewed Travelport evidence into durable decisions and otherwise fails closed to ambiguity.

This module does not collect card data, enable the `reservation` capability, or expose a booking action. It is the provider-specific post-write decision boundary used by the server-only initial Create, reviewed second Create, and Booking.com Sync flows.

## Success authority

A Create response can become `CONFIRMED` only when all required evidence agrees:

- HTTP status is successful;
- exactly one hospitality product matches the durable chain/property, stay dates, single-room quantity, and guest count;
- exactly one confirmed Travelport receipt carries both `sourceContext=Travelport` and `locatorType=PNR Locator`; and
- error and warning envelopes are structurally valid and bounded.

Travelport Stays responses can contain multiple locator families. A Travelport-context locator that is not a `PNR Locator` is not a provider reservation reference. It cannot confirm Create or Sync, and it does not create duplicate-PNR ambiguity when one valid Travelport PNR Locator is present.

Supplier confirmation is normalized separately only from a confirmed `sourceContext=Supplier` + `locatorType=Confirmation Number` receipt. Booking.com PIN, supplier cancellation-number, agency IATA, and unrelated locator values are not stored under the supplier-confirmation field.

## Price and guarantee review outcomes

Travelport Stays source codes `13016`, `13017`, and `13018` indicate a guarantee requirement changed during sell. Source code `13020` indicates the price changed. Travelport documents that the initial request stops without creating the reservation and that a second request is required only when the applicable change is explicitly accepted.

SF maps those outcomes to `REVIEW_REQUIRED` with one of:

- `GUARANTEE_CHANGED`;
- `PRICE_CHANGED`; or
- `PRICE_AND_GUARANTEE_CHANGED`.

The initial Create never sends `acceptGuaranteeChangeInd` or `acceptPriceChangeInd`.

The tenant-authorized acceptance service verifies the exact marked/completed Create attempt and repeats fresh SearchComplete, Rules, Availability, traveler, integration, and payment authority before persisting bounded non-secret acceptance evidence. The operation stays `REVIEW_REQUIRED`, so normal retry cannot consume the decision.

The one-time reviewed second-Create path is implemented separately. A read-only gate reconstructs and revalidates the accepted decision. Request composition, card validation, accepted-query selection, and OAuth finish before a serializable provider-boundary transaction archives immutable acceptance history, creates exactly one next `CREATE` attempt, clears the active acceptance slot, moves the operation to `SUBMITTING`, and writes `providerRequestStartedAt`. Only after that commit may the external POST begin.

The reviewed request sends only the exact accepted `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` parameter. Normal retry cannot enter this path or reuse accepted flags. If the provider reports another commercial change, SF starts a new `REVIEW_REQUIRED` cycle while prior acceptance remains immutable.

## `13034` and locator-less ambiguity

`13034` is intentionally not treated as retry authority. SF keeps the outcome at `AMBIGUOUS / TRAVELPORT_SYNC_REQUIRED` and does not invent a supplier confirmation, Travelport PNR Locator, or Booking.com Sync reference from that error response alone.

This is distinct from Travelport's documented supplier-confirmed/no-PNR warning path. For that warning, Sync recovery authority is retained only when the same response proves:

- the exact durable hospitality request;
- one confirmed supplier Confirmation Number;
- Booking.com supplier source `BO`;
- one bounded matching-offer authority; and
- no confirmed Travelport PNR Locator.

The supplier confirmation and opaque provider recovery authority are staged only after the durable Create provider marker exists. If the process crashes after staging but before settlement, stale-attempt recovery preserves that evidence and keeps another Create blocked.

## Definitive no-sell validation failures

Travelport's Stays error contract distinguishes unsuccessful `Result/Error` responses and, in newer error envelopes, provides `SourceCode` plus `category`. SF uses that evidence narrowly.

A provider error becomes durable `FAILED` only when:

- the error envelope is structurally valid and bounded;
- every error has `category=VALIDATION`;
- every source code is in SF's reviewed no-sell validation allowlist; and
- exactly one unique source code is present.

The normalized durable code is `TRAVELPORT_VALIDATION_<SourceCode>`. Provider message text is ignored.

Automatic retry is narrower than the no-sell allowlist. It is restricted to reviewed validation failures that can be corrected entirely in the server-only ephemeral payment-card source without changing durable reservation or traveler authority. Current retryable form-of-payment validation includes card fields, billing address, telephone, and reviewed supplier card-type validation codes already encoded by the classifier.

Traveler identity/contact validation remains non-retryable for the existing operation because traveler authority is bound into the durable reservation-payload fingerprint. Changing that payload requires a new reviewed reservation request rather than mutating the existing operation.

Unknown codes, mixed codes, contradictory categories, malformed error structures, transport failures, generic HTTP statuses, free-form provider messages, and other uncertain results do not become retryable.

## Structural warning and error authority

The presence of an `ErrorResponse` cannot be masked by confirmation-looking data. Malformed or oversized error collections fail closed.

Reservation warning evidence is also bounded. Malformed or oversized warning collections, conflicting `Warning`/`Warnings` shapes, and warning records without a bounded message prevent promotion to success. Bounded non-Sync warnings do not erase otherwise complete confirmation evidence.

The durable expected reservation is validated before it can match provider data. The current Create classifier recognizes only the supported single-room, one-to-nine-guest contract with canonical local dates and bounded Travelport chain/property identifiers.

## Durable settlement

`travelportStaysCreateOutcomeToSubmissionOutcome` remains the provider-specific bridge for ordinary confirmed, failed, and ambiguous outcomes. `REVIEW_REQUIRED` is deliberately routed through the dedicated review settlement boundary instead of the generic mapper.

A durable review transition requires the tenant-scoped current `CREATE` attempt, a non-null provider-request marker, a fixed normalized review reason, and matching operation state. The transition is non-retryable and clears locator/recovery fields that would conflict with the documented no-sell review state.

For Booking.com supplier-confirmed/no-PNR recovery, `recordHospitalitySupplierReservationProviderRecoveryEvidence` stages the supplier confirmation and opaque recovery reference only after the provider marker and before final settlement. Audit metadata records only that recovery evidence was staged, never the raw confirmation or recovery value.

## Privacy and observability

The classifier returns only normalized decision state, bounded provider/supplier/correlation evidence, fixed SF failure/review codes, and the small non-secret Sync recovery reference when its preconditions are proven. It does not return or log provider error messages, traveler data, form-of-payment data, PAN/CVV, credentials, tokens, request bodies, or response bodies.

Structured observations use fixed result names and SF-owned tenant/attempt correlation. Raw Travelport payloads are excluded.

## Validation and remaining activation gates

Focused tests cover commercial outcome classification, PNR-locator identity, price/guarantee review, payment-correction retry authority, malformed error/warning handling, Booking.com Sync recovery evidence, reviewed second-Create flag isolation, and privacy.

Travelport `reservation` remains disabled. Activation still requires:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned account;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery validation; and
3. authoritative live `13034`, negative lookup, locator-less correlation, and retry/recovery semantics.

No source-only test is claimed as live-provider evidence.

## References

- Travelport Stays API Error Messaging.
- Travelport Create Reservation Reference Payload API Reference.
- Travelport Sync Reservation API Reference.
- Travelport Stays APIs Guide.
- `docs/supplier-reservation-review-acceptance.md`.
- `docs/travelport-reservation-response-evidence.md`.
