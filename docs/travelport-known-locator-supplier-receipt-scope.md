# Travelport known-locator supplier receipt scope

## Purpose

Known-locator Travelport Stays recovery must prove that hotel supplier confirmation and cancellation evidence belongs to the exact active hotel offer before SF can use that evidence to settle or reject an ambiguous reservation operation.

This is a read-only provider-response rule inside the Travelport adapter. It does not enable Travelport `reservation`, Create, modification, cancellation, or any product-facing supplier write. It extends the offer namespace and passive-segment rules documented in `docs/travelport-known-locator-passive-receipts.md`.

## Provider evidence

Travelport's current Hotel Retrieve reference shows the active hotel as offer `O1`. Its supplier `Confirmation Number` receipt carries `OfferRef=["O1"]`, while the Travelport `PNR Locator` receipt is reservation-level and has no `OfferRef`.

The documented active-plus-passive Retrieve example uses the same ownership model: information related only to the active segment is identified with `O1`, passive-segment information is identified with `O2`, and the reservation-level Travelport PNR remains separate.

Travelport's current Hotel Cancel reference also returns the supplier `Cancellation Number` receipt with `OfferRef=["O1"]`, while the Travelport PNR receipt remains reservation-level.

References:

- `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm`
- `https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Cancel.htm`

## SF authority rule

When known-locator recovery supplies a durable reservation expectation, SF first identifies exactly one matching active `ProductHospitality` segment and retains that segment's validated offer ID as `activeHospitalityOfferId`.

Supplier confirmation and supplier cancellation lifecycle evidence are then accepted as active-hotel evidence only when all of the following are true:

- the receipt is structurally valid under the shared Stays receipt inspector;
- `OfferRef` is present as a bounded non-empty array;
- every referenced offer resolves to the bounded unique offer namespace returned in the same reservation;
- the `OfferRef` array contains no duplicate values; and
- the supplier receipt references exactly one offer and that offer is the validated active hotel offer.

A supplier `Confirmation Number` or `Cancellation Number` without `OfferRef` fails closed during known-locator recovery. Supplier evidence scoped to another active non-hospitality offer also fails closed. A receipt that tries to apply one supplier locator to multiple returned offers fails closed rather than being treated as hotel authority.

The Travelport PNR is deliberately different. The documented Stays response presents that locator at reservation level, so SF requires the canonical `Travelport + PNR Locator` used for known-locator recovery to remain unscoped. A PNR carrying `OfferRef` cannot be promoted into reservation-level hotel authority. See `docs/travelport-known-locator-pnr-receipt-scope.md`. This supplier scope rule must not force reservation-level PNR evidence into the segment-specific supplier model.

## Passive and multi-content behavior

The existing passive-offer boundary remains unchanged:

- the documented locator-less passive `AK` placeholder is excluded only under the narrow existing rule;
- passive-only PNR, supplier-confirmation, and supplier-cancellation evidence is structurally validated and excluded from active reservation authority;
- mixed active/passive `OfferRef` evidence fails closed; and
- unknown offer references fail closed.

Well-formed non-authoritative multi-content evidence remains supported. For example, `ReceiptPayment`, Agency IATA, Booking.com PIN, or unrelated shared-model evidence can remain associated with another active offer without being promoted to the active hotel's supplier confirmation or cancellation lifecycle.

## Why this matters

`TravelportStaysReservationRecoveryProvider` requires supplier confirmation before it can return provider-neutral `FOUND`. Without an exact active-hotel ownership check, a valid-looking supplier confirmation attached to another active segment could satisfy that requirement and settle the wrong reservation.

The same ownership rule protects cancellation semantics. A supplier cancellation belonging to another segment must not make the active hotel appear cancelled.

This check therefore binds the provider-neutral recovery decision to both durable hotel identity and provider-declared supplier-receipt ownership.

## Validation

Focused dependency-free behavior coverage verifies:

- the documented active-hotel supplier confirmation scoped to `O1` is accepted;
- an unscoped supplier confirmation is rejected;
- supplier confirmation scoped to another active non-hospitality offer is rejected;
- unscoped or differently scoped supplier cancellation evidence is rejected;
- active-hotel cancellation evidence still reaches the existing active-lifecycle rejection;
- duplicate receipt offer references are rejected; and
- unrelated well-formed multi-content receipt evidence on another active offer remains compatible.

The reservation-response source contract also locks `activeHospitalityOfferId`, exact supplier ownership, and duplicate `OfferRef` rejection.

Full repository validation still requires the supported Node 24 / TypeScript 6 dependency environment. PostgreSQL scenarios require an explicitly disposable database. Live Travelport behavior remains gated on provisioned non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.
