# Travelport Stays create-outcome classification

## Purpose

A supplier reservation POST is a commercial write. Once SF crosses that provider boundary, an HTTP or payload failure is not automatically evidence that no hotel was sold. The Travelport create-outcome classifier therefore converts only documented provider evidence into safe decisions and otherwise fails closed to an ambiguous reservation outcome.

This module does not collect card data, enable the `reservation` capability, or expose a booking action. It is the provider-specific post-write decision boundary consumed by the server-only Travelport create coordinator.

## Documented decisions

Travelport Stays source codes `13016`, `13017`, and `13018` mean the guarantee requirement changed during sell. Source code `13020` means the price changed during sell. Travelport documents that these cases pause booking and require a second reservation request only if the customer explicitly accepts the new guarantee or price. SF classifies these responses as `REVIEW_REQUIRED`, including a combined price-and-guarantee review when both documented change codes are returned; it never sends `acceptGuaranteeChangeInd` or `acceptPriceChangeInd` automatically and never treats the original reviewed authority as still valid.

Source code `13034` is materially different. Travelport documents the same error for both a timeout where Booking.com did not sell and a timeout where Booking.com did sell. The response alone therefore cannot establish retry safety. SF classifies `13034` as `AMBIGUOUS / TRAVELPORT_SYNC_REQUIRED`, with no supplier confirmation or Sync authority invented from the error response.

Travelport also documents a Booking.com failure mode in which the supplier sell succeeded but Travelport failed to finish PNR processing. In that case the reservation response can contain the confirmed supplier receipt but no Travelport PNR locator, together with the instruction to use Sync. SF preserves the bounded supplier confirmation only when the returned hospitality segment exactly matches the durable property, stay, room count, and guest count. It still remains `AMBIGUOUS` until Travelport Sync constructs the PNR and returns a verified Travelport locator.

For that exact warning path, SF now retains a provider-owned Sync recovery reference only when the same matching response also proves there is no Travelport locator, the supplier source is `BO` (Booking.com), and the matching offer contains a bounded `Identifier.authority`. Travelport documents that Sync must send the Availability offer authority and the supplier locator source. Incomplete or contradictory evidence keeps the reservation ambiguous but produces no Sync recovery authority.

Any unrecognized, malformed, or otherwise unprovable result after a commercial POST is `AMBIGUOUS / INVALID_RESPONSE`. The create coordinator never turns an unknown 4xx/5xx, malformed 2xx, or unexpected post-marker exception into a blind create retry.

## Structural response authority

Provider response structure is part of the proof required to call a commercial write successful. The classifier distinguishes the absence of an `ErrorResponse` from a malformed error envelope. Once an error envelope is present, it cannot be treated as a successful sell: only a complete set of documented price/guarantee change codes can become `REVIEW_REQUIRED`, while unknown, mixed, malformed, or oversized error evidence remains `AMBIGUOUS / INVALID_RESPONSE`. Source code `13034` remains the stronger fail-closed Sync signal even when the surrounding error response is imperfect.

Reservation warning evidence is bounded. Malformed or oversized warning collections, conflicting `Warning`/`Warnings` shapes, and warning records without a bounded message cannot be silently ignored before confirmation. Bounded non-Sync warnings do not erase otherwise complete confirmation evidence, but malformed warning structure prevents a response from being promoted to `CONFIRMED`.

The durable reservation expectation is validated before it can match provider data. The current create classifier only recognizes the supported single-room, one-to-nine-guest contract with canonical local dates and bounded Travelport chain/property identifiers. The Sync recovery authority is extracted from the same unique matching offer, rather than from unrelated response data.

## Durable recovery staging

The Travelport classifier does not write the database. The create coordinator stages complete Sync recovery evidence through `recordHospitalitySupplierReservationProviderRecoveryEvidence` only after the durable provider-request marker exists and before final create settlement.

That staging transaction independently requires server-side `booking:manage`, tenant/resource scope, the current `CREATE` attempt, and a non-null provider-request marker. It atomically stores the supplier confirmation plus the opaque provider recovery reference while the operation is still `SUBMITTING`. Database constraints allow this temporary state only when both pieces of recovery evidence are present.

If the process crashes before final settlement, the existing stale-attempt recovery can move the marked attempt to `AMBIGUOUS` without losing the staged recovery evidence. This preserves a future Sync path while keeping another Create Reservation attempt blocked.

The opaque recovery reference contains only Travelport-owned non-secret authority needed later by the provider adapter. Core supplier booking logic does not parse it, and audit metadata records only that recovery evidence was staged, never the confirmation or recovery value itself.

See `docs/travelport-booking-sync-recovery-authority.md` for the persistence contract and remaining Sync execution work.

## Durable ledger normalization

`travelportStaysCreateOutcomeToSubmissionOutcome` remains the provider-specific bridge from the Travelport classifier into the existing provider-neutral supplier reservation settlement contract. Confirmed evidence maps to `CONFIRMED`; uncertainty stays ambiguous; documented price/guarantee changes become fixed non-retryable failures. The provider recovery reference is staged separately before this settlement so the generic settlement contract does not learn Travelport-specific fields.

The non-retryable mapping for price/guarantee changes is intentional. Travelport states that a price or guarantee difference stops the initial sell before the reservation is created and that a second request may proceed only after explicit acceptance of the applicable change. SF does not yet implement that acceptance workflow.

## Privacy and evidence

The classifier returns only normalized decision state, bounded locator/correlation evidence, fixed SF failure/review codes, and the small non-secret provider recovery reference when the documented Booking.com Sync preconditions are proven. It does not return or log provider error messages, traveler data, form-of-payment data, PAN/CVV, credentials, request bodies, or response bodies.

Supplier confirmation evidence by itself never means that the Travelport reservation is fully confirmed. The provider PNR locator remains required for the normal lifecycle. Sync is a separate provider operation and still requires an authorized traveler and its own durable external-write execution semantics.

## References

- Travelport Stays API Error Messaging: source codes 13016-13018, 13020, and 13034.
- Travelport TripServices Stays APIs Guide: price/guarantee changes and Booking.com aggregator sell-failure cases.
- Travelport Create Reservation Reference Payload API Reference.
- Travelport Sync Reservation API Reference: `POST book/reservations/`, `passiveOfferInd=true`, offer identifier authority from Availability, supplier source/confirmation, and traveler details.

## Remaining boundary

The Travelport reservation capability stays disabled. The Create Reservation executor/coordinator and crash-safe Sync recovery-authority persistence now exist, but activation still requires a reviewed PCI-safe form-of-payment source/handling strategy, live non-production create validation, explicit authorized price/guarantee-change acceptance, the actual Sync executor/coordinator, and live validation of authoritative negative/correlation semantics. No current code path sends a Sync request.
