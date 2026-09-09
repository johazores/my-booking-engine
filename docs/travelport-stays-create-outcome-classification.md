# Travelport Stays create-outcome classification

## Purpose

A supplier reservation POST is a commercial write. Once SF crosses the provider boundary, an HTTP or payload failure is not automatically evidence that no hotel was sold. `classifyTravelportStaysReservationCreateOutcome` therefore converts only bounded, reviewed Travelport evidence into provider-specific decisions and otherwise fails closed to ambiguity.

This module does not collect card data, enable the `reservation` capability, or expose a booking action. It is the provider-specific post-write decision boundary used by the server-only initial Create and reviewed second Create flows; Booking.com Sync has its own constrained recovery executor.

## Success authority

A Create response can become `CONFIRMED` only when all required evidence agrees:

- HTTP status is successful;
- exactly one top-level `ReservationResponse` is present and no top-level `ErrorResponse` competes with it;
- `ReservationResponse.Result` contains no embedded error evidence;
- exactly one hospitality product matches the durable chain/property, stay dates, single-room quantity, and guest count;
- exactly one confirmed Travelport receipt carries both `sourceContext=Travelport` and `locatorType=PNR Locator`; and
- warning evidence is structurally valid and bounded.

Travelport Stays responses can contain multiple locator families. A confirmation receipt that claims the Stays-owned `sourceContext=Travelport` but pairs it with another locator type is contradictory evidence. It cannot confirm Create or Sync and fails closed even when one otherwise valid Travelport PNR Locator is also present. The same reciprocal pairing rule applies to Supplier and Agency Stays locator families; unrelated shared-model receipt evidence remains outside Stays authority only when it does not claim a recognized Stays source/locator pair.

Supplier confirmation is normalized separately only from a confirmed `sourceContext=Supplier` + `locatorType=Confirmation Number` receipt. Booking.com PIN, supplier cancellation-number, agency IATA, and unrelated locator values are not stored under the supplier-confirmation field.

Relevant commercial receipt evidence is inspected before confirmation-status filtering. Once a locator identifies itself as a Travelport PNR or supplier Confirmation Number, its bounded locator value must be valid and its receipt status must be exactly `Confirmed`. A second pending, cancelled, rejected, malformed, contradictorily paired, or duplicate relevant receipt invalidates the locator evidence instead of being ignored beside a valid receipt.

## Price and guarantee review outcomes

Travelport Stays source codes `13016`, `13017`, and `13018` indicate a guarantee requirement changed during sell. Source code `13020` indicates the price changed. Travelport documents that the initial request stops without creating the reservation and that a second request is required only when the applicable change is explicitly accepted.

SF maps those outcomes to a dedicated `REVIEW_REQUIRED` state with one of:

- `GUARANTEE_CHANGED`;
- `PRICE_CHANGED`; or
- `PRICE_AND_GUARANTEE_CHANGED`.

The initial Create never sends `acceptGuaranteeChangeInd` or `acceptPriceChangeInd`.

The tenant-authorized acceptance service verifies the exact marked/completed Create attempt and repeats fresh SearchComplete, Rules, Availability, traveler, integration, and payment authority before persisting bounded non-secret acceptance evidence. The operation stays `REVIEW_REQUIRED`, so normal retry cannot consume the decision.

The one-time reviewed second-Create path is implemented separately. A read-only gate reconstructs and revalidates the accepted decision. Request composition, card validation, accepted-query selection, and OAuth finish before a serializable provider-boundary transaction archives immutable acceptance history, creates exactly one next `CREATE` attempt, clears the active acceptance slot, moves the operation to `SUBMITTING`, and writes `providerRequestStartedAt`. Only after that commit may the external POST begin.

The reviewed request sends only the exact accepted `acceptPriceChangeInd=true` and/or `acceptGuaranteeChangeInd=true` parameter. Normal retry cannot enter this path or reuse accepted flags. If the provider reports another commercial change, SF starts a new `REVIEW_REQUIRED` cycle while prior acceptance remains immutable.

## `13034` and locator-less sell uncertainty

Travelport's Stays error reference documents `13034` as an `UNKNOWN` server-side outcome. The Stays guide is more specific about its operational meaning: the same unconfirmed-supplier error can represent either a timeout where no Booking.com sell occurred or a timeout where Booking.com sold the room but Travelport did not receive the response. The branch is determined by whether the traveler receives the Booking.com confirmation email.

That means `13034` by itself proves neither safe retry nor Sync authority. SF's provider classifier recognizes only a structurally valid homogeneous `13034` family from Travelport's newer SourceCode-bearing envelope, with `Category=UNKNOWN` and a numeric body `StatusCode` matching the actual HTTP response. Because that error response contains no verified supplier confirmation or recovery reference, `travelportStaysCreateOutcomeToSubmissionOutcome` normalizes the durable failure code to `TRAVELPORT_SELL_UNCERTAIN` while keeping the operation `AMBIGUOUS`.

SF does not invent a supplier confirmation, Travelport PNR Locator, Booking.com Sync reference, `NOT_FOUND`, or retryability from `13034`. A future product flow that chooses to resolve this branch must authenticate and validate externally obtained supplier confirmation evidence; raw user claims or free-form email text cannot directly authorize Sync.

This is distinct from Travelport's documented supplier-confirmed/no-PNR warning path. For that warning, `TRAVELPORT_SYNC_REQUIRED` and Sync recovery authority are retained only when the same response proves:

- the exact durable hospitality request;
- one confirmed supplier Confirmation Number;
- Booking.com supplier source `BO`;
- one bounded matching-offer authority; and
- no Travelport PNR Locator receipt at all.

An unconfirmed, malformed, or contradictorily paired relevant PNR receipt is contradictory evidence, not proof of a clean locator-less state, and blocks Sync recovery authority. The supplier confirmation and opaque provider recovery authority are staged only after the durable Create provider marker exists. If the process crashes after staging but before settlement, stale-attempt recovery preserves that evidence and keeps another Create blocked.

## Definitive no-sell validation failures

Travelport's Stays error contract uses two provisioned formats. The older format contains only `StatusCode` and `Message`; it cannot provide SourceCode/category authority. The newer format includes `StatusCode`, `SourceCode`, and `Category` in addition to non-authoritative provider text/source metadata. SF uses the newer decision-bearing evidence narrowly.

A provider error becomes durable `FAILED` only when:

- the top-level `ErrorResponse` envelope is structurally valid and bounded;
- every error includes a numeric `StatusCode` equal to the actual HTTP response status;
- every error has `category=VALIDATION`;
- every source code is in SF's reviewed no-sell validation allowlist; and
- exactly one unique source code is present.

A SourceCode-bearing envelope with missing Category or StatusCode is not treated as a legacy response. It is incomplete newer evidence and remains ambiguous.

The normalized durable code is `TRAVELPORT_VALIDATION_<SourceCode>`. Provider message text is ignored.

Automatic retry is narrower than the no-sell allowlist. It is restricted to reviewed validation failures that can be corrected entirely in the server-only ephemeral payment-card source without changing durable reservation or traveler authority. Current retryable form-of-payment validation includes card fields, billing address, telephone, and reviewed supplier card-type validation codes `1537` through `1547`, `13050`, `13054`, `13078`, and `13083` already encoded by the classifier.

Traveler identity/contact validation remains non-retryable for the existing operation because traveler authority is bound into the durable reservation-payload fingerprint. Changing that payload requires a new reviewed reservation request rather than mutating the existing operation.

Unknown codes, mixed codes, contradictory categories, missing/malformed/mismatched StatusCode evidence, malformed error structures, transport failures, generic HTTP statuses, free-form provider messages, and other uncertain results remain `AMBIGUOUS / INVALID_RESPONSE`; they do not become retryable.

## Structural warning and error authority

The top-level response family is exclusive and must agree with the HTTP outcome: `ReservationResponse` is accepted only on 2xx, while `ErrorResponse` is accepted only on 4xx/5xx. A body containing both families, neither family, or a family that contradicts the HTTP result fails closed before any commercial decision.

Travelport's shared `ReservationResponse` contract defines `Result` as the carrier for warning and error messages. Because a successful-looking reservation can therefore coexist structurally with embedded result evidence, SF explicitly rejects any non-null `ReservationResponse.Result.Error` evidence. The defensive undocumented plural `Result.Errors` shape is rejected as well. Embedded result errors cannot be reinterpreted as the Stays top-level no-sell error contract and cannot authorize confirmation, review, definitive failure, retry, or Sync recovery.

The presence of a top-level `ErrorResponse` cannot be masked by confirmation-looking data. Malformed or oversized error collections fail closed. Source-code decisions require complete newer decision-bearing evidence: numeric HTTP-consistent `StatusCode`, bounded `SourceCode`, and valid `Category`. The older StatusCode/Message-only format does not grant source-code-based retry, review, or recovery authority.

Reservation warning evidence is also bounded. Malformed or oversized warning collections, conflicting `Warning`/`Warnings` shapes, and warning records without a bounded message prevent promotion to success. Bounded warning-only `ReservationResponse.Result` data does not erase otherwise complete confirmation evidence.

The durable expected reservation is validated before it can match provider data. The current Create classifier recognizes only the supported single-room, one-to-nine-guest contract with canonical local dates and bounded Travelport chain/property identifiers.

## Durable settlement

`travelportStaysCreateOutcomeToSubmissionOutcome` is the provider-specific bridge for ordinary confirmed, failed, and ambiguous outcomes. It also prevents a raw provider-special-case name from becoming false operational authority: an ambiguous `TRAVELPORT_SYNC_REQUIRED` classifier result is persisted as `TRAVELPORT_SELL_UNCERTAIN` unless both a supplier confirmation and provider recovery reference are present. `REVIEW_REQUIRED` is deliberately routed through the dedicated review settlement boundary instead of the generic mapper.

A bounded supplier confirmation may still be retained as investigation evidence when the paired recovery reference is missing, but it is not Sync authority and the recovery-write claim remains blocked.

A durable review transition requires the tenant-scoped current `CREATE` attempt, a non-null provider-request marker, a fixed normalized review reason, and matching operation state. The transition is non-retryable and clears locator/recovery fields that would conflict with the documented no-sell review state.

For Booking.com supplier-confirmed/no-PNR recovery, `recordHospitalitySupplierReservationProviderRecoveryEvidence` stages the supplier confirmation and opaque recovery reference only after the provider marker and before final settlement. Audit metadata records only that recovery evidence was staged, never the raw confirmation or recovery value.

## Privacy and observability

The classifier and settlement mapper return only normalized decision state, bounded provider/supplier/correlation evidence, fixed SF failure/review codes, and the small non-secret Sync recovery reference when its preconditions are proven. They do not return or log provider error messages, traveler data, form-of-payment data, PAN/CVV, credentials, tokens, request bodies, or response bodies.

Structured observations use fixed result names and SF-owned tenant/attempt correlation. Raw Travelport payloads are excluded.

## Validation and remaining activation gates

Focused tests cover commercial outcome classification, top-level envelope exclusivity, embedded `ReservationResponse.Result` error rejection while preserving warning-only responses, complete SourceCode-bearing error-envelope authority and HTTP StatusCode coherence, reciprocal Stays locator pairing, PNR-locator identity, relevant receipt cardinality/status/malformed evidence, price/guarantee review, payment-correction retry authority, malformed error/warning handling, Booking.com Sync recovery evidence, complete and partial Sync-recovery settlement authority, 13034 sell-uncertain normalization, reviewed second-Create flag isolation, and privacy.

Travelport `reservation` remains disabled. Activation still requires:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned account;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery validation, including both documented `13034` branches; and
3. a deliberate authenticated mechanism if SF is to ingest externally received Booking.com confirmation evidence for Sync, plus verified negative-lookup and other locator-less correlation/retry semantics.

No source-only test is claimed as live-provider evidence.

## References

- Travelport Stays API Error Messaging.
- Travelport Stays APIs Guide, including Syncing Reservations after Aggregator Sell Failure.
- Travelport Create Reservation Reference Payload API Reference.
- Travelport Reservation Retrieve API Reference (`ReservationResponse.Result` error/warning semantics).
- Travelport Sync Reservation API Reference.
- `docs/supplier-reservation-review-acceptance.md`.
- `docs/travelport-reservation-response-evidence.md`.
