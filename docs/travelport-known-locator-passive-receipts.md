# Travelport known-locator passive receipt handling

## Purpose

SF known-locator Travelport recovery must identify the exact active hotel reservation without letting unrelated passive itinerary content become durable supplier authority or active-reservation lifecycle evidence. This is a read-only provider-response rule inside the Travelport adapter. It does not enable the Travelport `reservation` capability and does not broaden Create Reservation or Booking.com Sync success semantics.

## Provider response shape

Travelport's current Hotel Retrieve documentation includes a reservation with one active hotel offer (`O1`) and one placeholder passive hotel offer (`O2`). The active offer is explicitly `passiveOfferInd=false`; the placeholder is explicitly `passiveOfferInd=true`.

The same documented response also includes a placeholder receipt scoped to `OfferRef=["O2"]`. That receipt is `ReceiptConfirmation` / `ConfirmationHold` with `OfferStatusHospitality`, `code=AK`, and `Status=Confirmed`, but it intentionally has no `Locator`. Travelport describes the second offer as a placeholder passive segment and states that information related only to a segment is identified with that offer ID. In the documented examples the supplier confirmation and agency IATA evidence for the active segment carry `OfferRef=["O1"]`, while the reservation-level Travelport PNR locator is not scoped to the passive offer.

Reference: `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm`

## SF authority rule

Known-locator recovery first verifies the durable reservation expectation against exactly one non-passive `ProductHospitality` segment. During that same boundary every returned offer must expose one bounded, non-empty, unique `id`. Those IDs become the only valid namespace for receipt `OfferRef` evidence; a receipt that points to an unknown offer fails closed instead of being allowed to contribute supplier authority.

Only after active identity and offer-ID integrity succeed does Retrieve classify explicit passive offers. Before the shared Stays receipt inspector runs, Retrieve excludes the exact documented locator-less placeholder receipt shape when all of that receipt's bounded `OfferRef` values point to explicitly passive offer IDs. The ignored placeholder must be `ReceiptConfirmation` / `ConfirmationHold`, must have no `Locator`, and must carry `OfferStatusHospitality` with `code=AK` and `Status=Confirmed`.

Any other receipt scoped exclusively to explicit passive offers is first passed through the shared Stays receipt inspector. Malformed or contradictory Stays evidence still fails closed and cannot disappear merely because its `OfferRef` points to a passive segment. If the validated receipt contains a Travelport PNR Locator, supplier Confirmation Number, or supplier cancellation lifecycle locator, that durable identity/lifecycle evidence is then excluded from the active reservation evidence set because its ownership is proven to be passive-only.

This closes three false-authority cases at the same segment boundary:

- a passive supplier Confirmation Number cannot become the active reservation's `supplierConfirmationReference`;
- a passive Travelport PNR Locator cannot satisfy the known-locator active reservation requirement or create false duplicate-PNR ambiguity beside the real reservation-level PNR; and
- passive supplier cancellation evidence cannot make an otherwise active reservation appear cancelled.

If no active or reservation-level Travelport PNR remains after passive-owned evidence is removed, recovery fails closed rather than promoting the passive locator. If no active supplier confirmation remains, the recovery provider can return only a null supplier confirmation and the provider-neutral reconciliation boundary keeps the operation unresolved because Travelport requires supplier confirmation for `FOUND` settlement.

The exception remains intentionally narrow:

- every offer used for known-locator receipt scoping must have a bounded unique ID;
- an offer is never considered passive unless `passiveOfferInd === true`;
- malformed non-boolean passive flags still fail closed in the existing active-segment identity boundary;
- a receipt with malformed, empty, oversized, multiline, non-string, or unknown `OfferRef` evidence fails closed;
- a receipt that mixes active and passive offer references fails closed instead of being discarded;
- the exact locator-less passive AK/Confirmed placeholder is excluded;
- passive-only PNR, supplier confirmation, and supplier cancellation lifecycle evidence is structurally revalidated and excluded from active reservation authority;
- malformed or contradictory passive Stays locator/lifecycle evidence fails closed before exclusion;
- valid non-authoritative shared-model evidence such as supported Agency IATA, Booking.com PIN, payment, or unrelated multi-content receipt evidence can continue through the shared inspector without being promoted to active Stays authority;
- reservation-level receipts without `OfferRef`, including the documented Travelport PNR locator, remain in the active evidence set;
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
- a PNR scoped only to a passive offer cannot become active locator authority and does not create false duplicate ambiguity beside a valid active/reservation-level PNR;
- a supplier Confirmation Number scoped only to a passive offer cannot become the active reservation's supplier confirmation;
- supplier cancellation evidence scoped only to a passive offer cannot cancel the active reservation;
- malformed passive durable Stays evidence fails closed before exclusion;
- locator-less passive evidence outside the documented AK/Confirmed placeholder shape remains invalid; and
- malformed passive receipt offer references fail closed.

A dependency-free source contract also requires Retrieve to validate offer/receipt scoping and passive-owned durable authority before the final shared receipt inspection while Create/Sync continues to call the shared inspector directly.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Live provider behavior remains gated on provisioned Travelport non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.
