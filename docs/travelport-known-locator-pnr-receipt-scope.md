# Travelport known-locator PNR receipt scope

## Purpose

Known-locator Travelport Stays recovery must prove that the Travelport PNR used as the provider reservation reference is reservation-level evidence, not a locator owned by another returned offer. This rule is read-only and applies only when SF is reconciling an existing durable reservation expectation. It does not enable Travelport `reservation` or broaden Create/Sync behavior.

## Provider evidence

Travelport's current Hotel Retrieve examples present the supplier Confirmation Number and Agency IATA receipts with `OfferRef=["O1"]`, while the canonical `Travelport + PNR Locator` receipt is returned separately without `OfferRef`.

The active-plus-passive example follows the same model: offer-specific information is identified with `O1` or `O2`, while the Travelport PNR remains reservation-level.

Travelport's documented reservation-level PNR omits the `OfferRef` field; it does not return `OfferRef: null`. SF therefore treats field absence as the reservation-level evidence. An explicitly present null value is malformed scope evidence and cannot be promoted to omission.

Reference:

- `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm`

## SF authority rule

After known-locator recovery validates the returned offer namespace and identifies exactly one active `ProductHospitality` offer matching the durable property, stay dates, room quantity, and guest count:

- the canonical Travelport PNR may contribute provider reservation authority only when it is reservation-level and the `OfferRef` field is genuinely absent;
- explicit `OfferRef: null` fails closed before reservation-level receipt interpretation;
- a Travelport PNR carrying `OfferRef` to the active hotel fails closed rather than being reinterpreted as reservation-level evidence;
- a Travelport PNR scoped to another active offer also fails closed and cannot satisfy the hotel reservation locator;
- mixed active/passive offer references remain invalid under the existing receipt-scope boundary;
- a PNR scoped exclusively to an explicit passive offer remains structurally validated and excluded from active reservation authority under the existing passive-receipt rule; and
- the final active evidence set must still contain exactly one Travelport PNR matching the durable requested locator.

Supplier Confirmation Number and Cancellation Number evidence remains segment-specific and must point exactly to the validated active hotel offer as documented in `docs/travelport-known-locator-supplier-receipt-scope.md`. Explicit null `OfferRef` on any known-locator receipt is malformed rather than unscoped.

This prevents a valid-looking PNR associated with a different active segment, or an explicitly null ownership field, from being promoted into hotel recovery authority merely because its locator value matches the durable reference.

## Scope isolation

This restriction belongs to `parseTravelportStaysReservationResponse` when `expectedReservation` is supplied. The commercial Create/Booking.com Sync classifier independently enforces the same absent-not-null invariant for relevant PNR/supplier receipt ownership. The rule does not create new durable fields, provider calls, reservation writes, logging fields, or user-facing workflows.

## Validation

Focused behavior coverage verifies the documented absent PNR `OfferRef` remains accepted, explicit null scope is rejected for both Travelport PNR and supplier confirmation evidence, an `O1`-scoped PNR is rejected, a PNR scoped to another active non-hospitality offer is rejected, supplier offer ownership rules continue to pass/fail as expected, and unrelated well-formed multi-content payment evidence remains compatible.

A dependency-free source contract pins explicit-null rejection before reservation-level receipt interpretation and preserves scoped-PNR rejection before active receipt acceptance. Full repository validation still requires the supported Node 24 / TypeScript 6 dependency environment. Live Travelport behavior remains gated on provisioned non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.
