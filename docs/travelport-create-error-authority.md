# Travelport Create Error Authority

## Purpose

Travelport Create Reservation is a commercial write. SF must not turn one provider source code inside a malformed or mixed error payload into authority to retry, review, or perform a Booking.com recovery write. Post-write decisions therefore require bounded, structurally valid provider evidence and fail closed when the evidence conflicts.

## Special source-code families

Travelport's current Stays error reference classifies source codes `13016`, `13017`, and `13018` as guarantee-change validation errors and `13020` as a price-change validation error. When the newer error envelope returns a category, SF accepts these review decisions only with `VALIDATION`. Category-less legacy envelopes keep the existing review behavior, but an explicit contradictory category or any unrelated source code in the same error family becomes `AMBIGUOUS / INVALID_RESPONSE`.

Travelport's Stays reference classifies `13034` as `UNKNOWN`, not as proof that no supplier sell happened. SF now grants the normalized `TRAVELPORT_SYNC_REQUIRED` outcome from an error response only when the error envelope is structurally valid and every returned error is `13034`. If a category is present it must be `UNKNOWN`; an explicit contradictory category, malformed error entry, or mixed source-code family remains `AMBIGUOUS / INVALID_RESPONSE`.

This source-code classification does not create Booking.com Sync authority. `13034` still carries no verified supplier confirmation or Availability offer authority, so the server-only Sync coordinator cannot be claimed from that error alone. Sync authority continues to require the separately documented supplier-confirmed/no-PNR response evidence.

## Retry and acceptance boundary

Travelport documents that price or guarantee changes stop the initial sell and that a subsequent Create Reservation request may proceed only after the applicable change is explicitly accepted. SF still does not send `acceptPriceChangeInd` or `acceptGuaranteeChangeInd` automatically. The current review outcome settles the existing operation as non-retryable and requires a future explicit authorized acceptance flow with fresh offer, Rules, Availability, traveler, and payment authority.

Transport uncertainty, malformed provider envelopes, mixed special source codes, conflicting categories, or unknown source codes never become retry authority. They remain ambiguous unless another reviewed provider-specific rule proves a definitive no-sell result.

## Activation boundary

The Travelport `reservation` capability remains disabled. This hardening closes a response-authority gap but does not replace live non-production validation of locator-less `13034` correlation/negative behavior, the reviewed PCI-safe form-of-payment source, explicit price/guarantee acceptance, or the remaining end-to-end activation gates.

References:

- Travelport Stays API Error Messaging: source-code categories and `13034` behavior.
- Travelport Create Reservation Reference Payload: price/guarantee change acceptance semantics.
- `docs/travelport-stays-create-outcome-classification.md`
- `docs/travelport-booking-sync-recovery-authority.md`
