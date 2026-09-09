# Travelport known-locator passive receipt handling

## Purpose

SF known-locator Travelport recovery must identify the exact active hotel reservation without letting unrelated passive itinerary content become durable supplier authority. This is a read-only provider-response rule inside the Travelport adapter. It does not enable the Travelport `reservation` capability and does not broaden Create Reservation or Booking.com Sync success semantics.

## Provider response shape

Travelport's current Hotel Retrieve documentation includes a reservation with one active hotel offer (`O1`) and one placeholder passive hotel offer (`O2`). The active offer is explicitly `passiveOfferInd=false`; the placeholder is explicitly `passiveOfferInd=true`.

The same documented response also includes a placeholder receipt scoped to `OfferRef=["O2"]`. That receipt is `ReceiptConfirmation` / `ConfirmationHold` with `OfferStatusHospitality`, `code=AK`, and `Status=Confirmed`, but it intentionally has no `Locator`. Travelport describes AK as the placeholder-only passive status and states that information related only to the passive segment is identified with that offer reference.

Reference: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm`

## SF authority rule

Known-locator recovery first verifies the durable reservation expectation against exactly one non-passive `ProductHospitality` segment. Only after that active identity succeeds does it collect bounded IDs from offers explicitly marked `passiveOfferInd=true`.

Before the shared Stays receipt inspector runs, Retrieve excludes only the exact documented locator-less placeholder receipt shape, and only when all of that receipt's bounded `OfferRef` values point to those explicitly passive offer IDs. The ignored receipt must be `ReceiptConfirmation` / `ConfirmationHold`, must have no `Locator`, and must carry `OfferStatusHospitality` with `code=AK` and `Status=Confirmed`. This keeps Travelport's documented placeholder receipt from invalidating an otherwise authoritative active reservation response without hiding supplier, PNR, or cancellation locators merely because they are scoped to a passive offer.

The exception is intentionally narrow:

- an offer is never considered passive unless `passiveOfferInd === true`;
- malformed non-boolean passive flags still fail closed in the existing active-segment identity boundary;
- a receipt with malformed, empty, oversized, multiline, or non-string `OfferRef` evidence fails closed;
- a receipt that mixes active and passive offer references fails closed instead of being discarded;
- a locator-less receipt whose offer reference does not identify an explicit passive offer still reaches the shared receipt inspector and fails closed;
- a passive-scoped receipt with any locator is not discarded and remains subject to the shared locator/cancellation rules;
- a passive-scoped locator-less receipt that is not the documented AK/Confirmed placeholder shape is not discarded and therefore remains fail closed;
- reservation-level receipts without `OfferRef`, including the Travelport PNR locator, remain in the active evidence set;
- active-offer supplier Confirmation Number and cancellation evidence remain subject to the existing shared receipt and lifecycle rules.

This means only the documented passive placeholder signal can be ignored, and only because the provider both identifies its exact AK shape and scopes it exclusively to an explicitly passive offer. Passive offer scoping alone can never hide durable locator or cancellation evidence.

## Create and Sync isolation

The passive receipt exception belongs only to `parseTravelportStaysReservationResponse`, which is used by read-only known-locator recovery. The Create/Booking.com Sync commercial-write classifier continues to send its complete receipt collection directly to `inspectTravelportStaysReservationReceiptEvidence` and keeps its stricter write-confirmation rules.

This separation is important because Booking.com Sync itself uses `passiveOfferInd=true` while returning supplier Confirmation Number and PIN evidence that is commercial recovery authority. Retrieve-only passive filtering must not be reused by Sync or Create.

## Validation

Focused behavior coverage verifies:

- the documented active `O1` plus passive placeholder `O2` response, including the locator-less AK receipt, is accepted for known-locator recovery;
- the active Travelport PNR and active supplier Confirmation Number remain the normalized durable evidence;
- a locator-less receipt referring to an unknown/non-passive offer remains invalid;
- mixed active/passive `OfferRef` evidence fails closed;
- passive-scoped durable locator evidence is not discarded;
- locator-less passive evidence outside the documented AK/Confirmed placeholder shape remains invalid; and
- malformed passive receipt offer references fail closed.

A dependency-free source contract also requires Retrieve to perform the passive-offer scoping before the shared receipt inspector while Create/Sync continues to call the shared inspector directly.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Live provider behavior remains gated on provisioned Travelport non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.
