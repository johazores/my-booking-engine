# Travelport known-locator passive receipt handling

## Purpose

SF known-locator Travelport recovery must identify the exact active hotel reservation without letting unrelated passive itinerary content become durable supplier authority. This is a read-only provider-response rule inside the Travelport adapter. It does not enable the Travelport `reservation` capability and does not broaden Create Reservation or Booking.com Sync success semantics.

## Provider response shape

Travelport's current Hotel Retrieve documentation includes a reservation with one active hotel offer (`O1`) and one placeholder passive hotel offer (`O2`). The active offer is explicitly `passiveOfferInd=false`; the placeholder is explicitly `passiveOfferInd=true`.

The same documented response also includes a placeholder receipt scoped to `OfferRef=["O2"]`. That receipt is `ReceiptConfirmation` / `ConfirmationHold` with `OfferStatusHospitality`, `code=AK`, and `Status=Confirmed`, but it intentionally has no `Locator`. Travelport describes the second offer as a placeholder passive segment and states that information related only to that segment is identified with offer `O2`.

Reference: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm`

## SF authority rule

Known-locator recovery first verifies the durable reservation expectation against exactly one non-passive `ProductHospitality` segment. During that same boundary every returned offer must expose one bounded, non-empty, unique `id`. Those IDs become the only valid namespace for receipt `OfferRef` evidence; a receipt that points to an unknown offer fails closed instead of being allowed to contribute supplier authority.

Only after active identity and offer-ID integrity succeed does Retrieve classify explicit passive offers. Before the shared Stays receipt inspector runs, Retrieve excludes the exact documented locator-less placeholder receipt shape when all of that receipt's bounded `OfferRef` values point to explicitly passive offer IDs. The ignored placeholder must be `ReceiptConfirmation` / `ConfirmationHold`, must have no `Locator`, and must carry `OfferStatusHospitality` with `code=AK` and `Status=Confirmed`.

Supplier Confirmation Number evidence receives one additional segment-authority rule. If a structurally valid `Supplier + Confirmation Number` receipt is scoped exclusively to an explicit passive offer, Retrieve validates that receipt with the shared Stays inspector and then removes it from the active reservation evidence set. It can therefore never fill the active reservation's `supplierConfirmationReference`. If no active supplier confirmation remains, the Travelport recovery provider can return only a null supplier confirmation and the provider-neutral reconciliation boundary keeps the operation unresolved because Travelport requires supplier confirmation for `FOUND` settlement.

This closes a false-authority case where a valid passive supplier confirmation could otherwise become the only supplier confirmation seen by the shared inspector. Malformed passive supplier confirmation evidence still fails closed before it can be removed, so passive scoping cannot hide contradictory Stays structure.

The exception remains intentionally narrow:

- every offer used for known-locator receipt scoping must have a bounded unique ID;
- an offer is never considered passive unless `passiveOfferInd === true`;
- malformed non-boolean passive flags still fail closed in the existing active-segment identity boundary;
- a receipt with malformed, empty, oversized, multiline, non-string, or unknown `OfferRef` evidence fails closed;
- a receipt that mixes active and passive offer references fails closed instead of being discarded;
- the exact locator-less passive AK/Confirmed placeholder is excluded;
- a passive supplier Confirmation Number is structurally revalidated and excluded from active supplier authority;
- a passive-scoped PNR, cancellation locator, or other non-placeholder receipt is not reclassified as active evidence and continues through the existing shared/cardinality/lifecycle rules unless covered by the narrow supplier-confirmation rule above;
- reservation-level receipts without `OfferRef`, including the Travelport PNR locator, remain in the active evidence set;
- active-offer supplier Confirmation Number and cancellation evidence remain subject to the existing shared receipt and lifecycle rules.

This means passive offer scoping can remove only provider evidence whose passive ownership is proven by the returned offer namespace. It cannot turn passive evidence into active reservation authority, and it cannot hide malformed Stays confirmation structure.

## Create and Sync isolation

The passive receipt rules belong only to `parseTravelportStaysReservationResponse`, which is used by read-only known-locator recovery. The Create/Booking.com Sync commercial-write classifier continues to send its complete receipt collection directly to `inspectTravelportStaysReservationReceiptEvidence` and keeps its stricter write-confirmation rules.

This separation is important because Booking.com Sync itself uses `passiveOfferInd=true` while returning supplier Confirmation Number and PIN evidence that is commercial recovery authority. Retrieve-only passive filtering must not be reused by Sync or Create.

## Validation

Focused behavior coverage verifies:

- the documented active `O1` plus passive placeholder `O2` response, including the locator-less AK receipt, is accepted for known-locator recovery;
- the active Travelport PNR and active supplier Confirmation Number remain the normalized durable evidence;
- receipt `OfferRef` values must resolve to returned offer IDs;
- returned offer IDs must be present, bounded, and unique before receipt scoping;
- mixed active/passive `OfferRef` evidence fails closed;
- passive-scoped PNR evidence is not hidden;
- a supplier Confirmation Number scoped only to a passive offer cannot become the active reservation's supplier confirmation;
- malformed passive supplier confirmation evidence fails closed before exclusion;
- locator-less passive evidence outside the documented AK/Confirmed placeholder shape remains invalid; and
- malformed passive receipt offer references fail closed.

A dependency-free source contract also requires Retrieve to validate offer/receipt scoping before the shared receipt inspector while Create/Sync continues to call the shared inspector directly.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Live provider behavior remains gated on provisioned Travelport non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.
