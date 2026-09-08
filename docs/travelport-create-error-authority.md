# Travelport Create Error Authority

## Purpose

Travelport Create Reservation is a commercial write. SF must not turn one provider source code inside a malformed or mixed error payload into authority to retry, review, or perform a Booking.com recovery write. Post-write decisions therefore require bounded, structurally valid provider evidence and fail closed when the evidence conflicts.

## Special source-code families

Travelport's current Stays error reference classifies source codes `13016`, `13017`, and `13018` as guarantee-change validation errors and `13020` as a price-change validation error. When the newer error envelope returns a category, SF accepts these review decisions only with `VALIDATION`. Category-less legacy envelopes keep the existing review behavior, but an explicit contradictory category or any unrelated source code in the same error family becomes `AMBIGUOUS / INVALID_RESPONSE`.

Travelport's Stays reference classifies `13034` as `UNKNOWN` and its Stays guide documents two branches behind the same error text: the supplier may not have sold the room, or Booking.com may have sold it but the response timed out before Travelport received confirmation. The deciding evidence is an external Booking.com confirmation email, not the `13034` response itself.

SF therefore does not persist locator-less `13034` as though Sync were already proven necessary. The provider classifier still recognizes the bounded homogeneous `13034` family, but the adapter-to-core settlement mapper normalizes that no-confirmation/no-recovery outcome to `AMBIGUOUS / TRAVELPORT_SELL_UNCERTAIN`. It carries no supplier confirmation, Travelport PNR Locator, or Sync recovery reference and is never retry authority.

`TRAVELPORT_SYNC_REQUIRED` is reserved at the durable settlement boundary for supplier-confirmed recovery evidence, such as Travelport's separate sell-confirmed/no-PNR warning path where the response itself can prove the exact stay, Booking.com supplier confirmation, supplier source, matching offer authority, and absence of a Travelport PNR Locator.

## Retry and acceptance boundary

Travelport documents that price or guarantee changes stop the initial sell and that a subsequent Create Reservation request may proceed only after the applicable change is explicitly accepted. SF does not send `acceptPriceChangeInd` or `acceptGuaranteeChangeInd` automatically. The current review outcome settles the existing operation into dedicated `REVIEW_REQUIRED` state; authorized acceptance and the one-time reviewed second Create are separate server-only boundaries with fresh offer, Rules, Availability, traveler, integration, and payment authority.

Transport uncertainty, malformed provider envelopes, mixed special source codes, conflicting categories, unknown source codes, and `13034` without supplier-confirmed recovery evidence never become retry authority. They remain ambiguous unless another reviewed provider-specific rule proves a definitive no-sell result.

## Activation boundary

The Travelport `reservation` capability remains disabled. This hardening resolves the source-only meaning of `13034` without pretending SF can observe the traveler's external Booking.com email. Production activation still requires a concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation including both documented `13034` branches, a deliberate authenticated mechanism if SF is to ingest external supplier confirmation for Sync, and verified negative-lookup/other locator-less correlation behavior.

References:

- Travelport Stays API Error Messaging.
- Travelport Stays APIs Guide, including Syncing Reservations after Aggregator Sell Failure.
- Travelport Create Reservation Reference Payload.
- `docs/travelport-stays-create-outcome-classification.md`.
- `docs/travelport-booking-sync-recovery-authority.md`.
