# Travelport Create Error Authority

## Purpose

Travelport Create Reservation is a commercial write. SF must not turn one provider source code inside a malformed or mixed error payload into authority to retry, review, or perform a Booking.com recovery write. Post-write decisions therefore require bounded, structurally valid provider evidence and fail closed when the evidence conflicts.

## Error-envelope authority

Travelport's current Stays error documentation describes two provisioned error formats. The older format returns only `StatusCode` and `Message`. The newer format returns `StatusCode`, `Message`, `SourceID`, `SourceCode`, and `Category`; its current JSON example serializes the enclosing `Result` with `@type=Result`, each newer error as `@type=ErrorDetail`, and the category member as lowercase `category`.

SF requires one mutually exclusive top-level commercial response envelope before any provider evidence can grant authority. A 2xx Create or Sync result may carry `ReservationResponse`; a 4xx/5xx provider result may carry `ErrorResponse`. A body containing both envelopes, neither envelope, `ErrorResponse` on 2xx/3xx, or `ReservationResponse` on a non-2xx result is contradictory transport/application evidence and becomes `AMBIGUOUS / INVALID_RESPONSE`. Envelope presence is property-based: an explicitly present JSON `null` is malformed competing evidence, not equivalent to provider omission, so `ErrorResponse: null` cannot disappear beside a successful reservation and `ReservationResponse: null` cannot disappear beside an error that would otherwise authorize review or retry semantics. When both envelopes are present, SF does not choose either provider trace identifier as authoritative correlation evidence.

Production reservation transport also binds application error bodies to the durable outbound attempt before this classifier can use them. Travelport's current Stays error catalog uses HTTP 500 for structured business/application failures as well as generic server failures, so an HTTP 500 `ErrorResponse` must echo the exact SF attempt trace in both the response header and payload. Missing or mismatched HTTP 500 trace evidence fails closed before `SourceCode`, category, retry, review, definitive-failure, or recovery semantics can be considered. Authentication (`401`/`403`), rate-limit (`429`), and provider/gateway statuses above 500 retain their existing status pass-through behavior; this change is narrowly scoped to the documented HTTP 500 application-error boundary.

Travelport's shared `ReservationResponse` model also defines `Result` as the place where warning or error messages can be returned. SF therefore requires a present `ReservationResponse.Result` to be a structured object and rejects any present `ReservationResponse.Result.Error` evidence before a success-looking reservation can grant confirmation or Sync authority; the defensive unsupported plural `Result.Errors` shape is rejected as well. Explicit `null` for `Result`, `Result.Error`, or `Result.Errors` is malformed presentation rather than omission. Warning-only `Result` data remains allowed when all durable reservation evidence agrees, but a present `Warning`/`Warnings` field must be the supported bounded array shape, so explicit `null` warning fields fail closed. Embedded result errors are not reclassified as Stays top-level `ErrorResponse` evidence and cannot grant retry, review, definitive failure, or recovery authority.

SF never treats a partial SourceCode-bearing payload as documented legacy evidence. Any decision that depends on `SourceCode` now requires the complete documented newer error structure: `Result.@type=Result`, `Error.@type=ErrorDetail`, bounded non-empty `SourceID` and `Message` values, a numeric `StatusCode`, a bounded numeric `SourceCode`, and the documented lowercase `category` member. The `ErrorResponse.Result` used for source-code authority cannot simultaneously contain the unsupported plural `Errors` member or any `Warning`/`Warnings` sibling. The body `StatusCode` must equal the actual HTTP response status. Missing, null, malformed, oversized, line-broken, wrong-family, mixed-family, or HTTP-inconsistent evidence becomes `AMBIGUOUS / INVALID_RESPONSE` before any source-code family can grant retry, review, or recovery semantics.

The JSON member `Category` is not accepted as an alias for the currently documented lowercase `category` field. In particular, a null lowercase `category` cannot fall through to `Category`, and a payload containing both names cannot hide contradictory category evidence behind JavaScript nullish-coalescing behavior.

Provider `Message` text and `SourceID` values are not durable commercial authority and are not copied into the normalized result, logs, or reservation ledger. They are checked only as bounded structural evidence that the SourceCode-bearing error matches the documented newer envelope.

## Special source-code families

Travelport's current Stays error reference classifies source codes `13016`, `13017`, and `13018` as guarantee-change validation errors and `13020` as a price-change validation error. SF accepts these review decisions only from complete newer error evidence with `category=VALIDATION` and HTTP-consistent `StatusCode`. A missing or contradictory category, a missing or contradictory status, or any unrelated source code in the same error family becomes `AMBIGUOUS / INVALID_RESPONSE`.

Travelport's Stays reference classifies `13034` as `UNKNOWN` with HTTP 500 and its Stays guide documents two branches behind the same error text: the supplier may not have sold the room, or Booking.com may have sold it but the response timed out before Travelport received confirmation. The deciding evidence is an external Booking.com confirmation email, not the `13034` response itself. Because this is a documented HTTP 500 application error, the response must also satisfy the production response-trace binding before SF recognizes the source-code family at all.

SF therefore does not persist locator-less `13034` as though Sync were already proven necessary. The provider classifier recognizes only a bounded homogeneous `13034` family from complete newer error evidence with `category=UNKNOWN` and matching HTTP status, but the adapter-to-core settlement mapper normalizes that no-confirmation/no-recovery outcome to `AMBIGUOUS / TRAVELPORT_SELL_UNCERTAIN`. It carries no supplier confirmation, Travelport PNR Locator, or Sync recovery reference and is never retry authority.

`TRAVELPORT_SYNC_REQUIRED` is reserved at the durable settlement boundary for supplier-confirmed recovery evidence, such as Travelport's separate sell-confirmed/no-PNR warning path where the response itself can prove the exact stay, Booking.com supplier confirmation, supplier source, matching offer authority, and absence of a Travelport PNR Locator.

At durable settlement, missing either half of the required recovery pair fails closed. A supplier confirmation without the opaque provider recovery reference, or a recovery reference without its supplier confirmation, is normalized to `AMBIGUOUS / TRAVELPORT_SELL_UNCERTAIN`. Partial evidence cannot authorize Sync.

## Retry and acceptance boundary

Travelport documents that price or guarantee changes stop the initial sell and that a subsequent Create Reservation request may proceed only after the applicable change is explicitly accepted. SF does not send `acceptPriceChangeInd` or `acceptGuaranteeChangeInd` automatically. The current review outcome settles the existing operation into dedicated `REVIEW_REQUIRED` state; authorized acceptance and the one-time reviewed second Create are separate server-only boundaries with fresh offer, Rules, Availability, traveler, integration, and payment authority.

Transport uncertainty, malformed provider envelopes, embedded `ReservationResponse.Result` errors, mixed special source codes, conflicting top-level response envelopes, conflicting categories, HTTP-inconsistent status evidence, unknown source codes, and `13034` without supplier-confirmed recovery evidence never become retry authority. They remain ambiguous unless another reviewed provider-specific rule proves a definitive no-sell result.

## Activation boundary

The Travelport `reservation` capability remains disabled. This hardening resolves the source-only meaning of contradictory success/error evidence without pretending SF can observe the traveler's external Booking.com email. Production activation still requires a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation including both documented `13034` branches, a deliberate authenticated mechanism if SF is to ingest external supplier confirmation for Sync, and verified negative-lookup/other locator-less correlation behavior.

References:

- Travelport Stays API Error Messaging.
- Travelport Stays APIs Guide, including Syncing Reservations after Aggregator Sell Failure.
- Travelport Create Reservation Reference Payload.
- Travelport Reservation Retrieve API Reference (`ReservationResponse.Result` error/warning semantics).
- `docs/travelport-stays-create-outcome-classification.md`.
- `docs/travelport-booking-sync-recovery-authority.md`.
- `docs/travelport-reservation-envelope-null-authority.md`.
- `docs/travelport-reservation-response-trace-authority.md`.
