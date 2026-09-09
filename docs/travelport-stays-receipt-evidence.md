# Travelport Stays receipt evidence

## Purpose

SF treats Travelport reservation receipts as commercial identity evidence, not as loosely typed metadata. The same provider-specific receipt inspection boundary is used by known-locator Hotel Retrieve and by the Create/Booking.com Sync commercial outcome classifier so malformed or contradictory receipt structure cannot be ignored beside one otherwise valid locator.

This boundary does not enable the Travelport `reservation` capability. It only strengthens response interpretation for already-implemented server-only reservation lifecycle work. Activation still depends on the separately documented PCI-safe payment/guarantee source and live non-production provider verification.

## Stays locator authority

Travelport's current Hotel Create/Retrieve response examples use `ReceiptConfirmation` entries for the hotel locator families that SF needs:

- Travelport `PNR Locator` with `sourceContext=Travelport`;
- supplier `Confirmation Number` with `sourceContext=Supplier`; and
- agency `IATA Number` with `sourceContext=Agency`.

SF normalizes only the first two as durable reservation identifiers. Cancellation lifecycle evidence is tracked separately and cannot be mistaken for either durable identifier. That lifecycle evidence includes supplier `Cancellation Number` confirmation receipts and self-identifying Stays `ReceiptCancellation` records.

Travelport's documented Booking.com Sync response can additionally return a supplier `Pin code` alongside the supplier confirmation number. SF treats `Supplier + Pin code` as supported Stays operational evidence so a valid Booking.com response is not rejected, but the PIN is never promoted to `supplierConfirmationReference`, provider reservation identity, recovery authority, audit metadata, or logs. It is structurally validated and discarded after receipt inspection.

The shared inspector requires the receipt collection to be bounded and every receipt entry that claims Stays authority to be structurally readable. A Stays confirmation that partially presents `sourceContext`/`locatorType`, has malformed locator/status/source text, omits a required Stays locator field, or pairs a recognized Stays locator type with an unsupported source context fails closed. Durable Travelport authority is only `Travelport + PNR Locator`; durable Supplier authority is only `Supplier + Confirmation Number`; supplier lifecycle cancellation evidence includes `Supplier + Cancellation Number`; Agency evidence is only `Agency + IATA Number`; and the documented non-durable Booking.com PIN pair is only `Supplier + Pin code`. The pairing is reciprocal: a recognized Stays locator type presented under a foreign source context also fails closed. This prevents contradictory provider-owned locator metadata from disappearing as if it were unrelated multi-content evidence while preserving documented auxiliary supplier evidence.

Travelport's current Hotel Create, Retrieve, Cancel, and Sync examples identify Stays confirmation structure with `Confirmation.@type=ConfirmationHold`, and active/cancelled hotel status evidence with `OfferStatus.@type=OfferStatusHospitality`. SF therefore rejects an explicitly present conflicting or malformed inner discriminator before that receipt can become Stays locator or supported auxiliary evidence. A supported Stays locator cannot be accepted from an object that explicitly identifies its confirmation or status as another content family. Omitted inner discriminators remain tolerated for backward/provider-shape compatibility; they do not create authority by themselves and all existing locator-pair, status, cardinality, reservation-identity, and lifecycle checks still apply.

Travelport's shared Reservation Retrieve contract also documents `ReceiptCancellation` with `Cancellation` instead of `Confirmation`, and currently says an upcoming release will align cancelled GDS and NDC responses on that receipt family. SF therefore no longer blindly discards every `ReceiptCancellation`. A cancellation record becomes Stays lifecycle evidence only when it identifies itself with a canonical Stays locator pair or an explicit `OfferStatusHospitality` discriminator. Relevant cancellation records require bounded locator/source values, `CancellationHold` when an inner cancellation type is present, `OfferStatusHospitality` when an inner status type is present, and `Status=Cancelled` whenever an offer-status object is supplied. Contradictory Stays cancellation evidence fails closed.

Create/Sync rejects any Stays cancellation lifecycle evidence because a cancelled supplier/provider lifecycle cannot prove an active successful write. Active known-locator recovery applies the same cancellation rejection before returning provider-neutral `FOUND`.

## Multi-content compatibility

Travelport's shared reservation model can also contain non-hotel receipt families such as `ReceiptPayment`, generic air/NDC `ReceiptCancellation`, and confirmation locators owned by other content such as OrderId/VendorLocator. Those records are not relabeled as Stays reservation authority.

SF therefore distinguishes unrelated bounded multi-content evidence from malformed Stays evidence:

- bounded `ReceiptPayment` records remain outside Stays authority;
- generic `ReceiptCancellation` records without a canonical Stays locator pair or explicit `OfferStatusHospitality` remain outside Stays authority; this includes the documented air GDS cancellation shape using `sourceContext=Travelport` with generic `locatorType=Locator` rather than the Stays `PNR Locator` family;
- a self-identifying Stays `ReceiptCancellation` is normalized only as cancellation lifecycle evidence and can never become a provider PNR or supplier confirmation;
- a generic confirmation locator with neither Stays `sourceContext` nor `locatorType` is ignored;
- a non-Stays source context without `locatorType` can remain outside Stays authority;
- Travelport, Supplier, or Agency Stays contexts cannot omit `locatorType`, and a locator type cannot be presented without its source context;
- recognized Stays source contexts and recognized Stays locator types must form a supported pair rather than being silently ignored when either side is contradictory;
- `Supplier + Pin code` is the documented non-durable auxiliary confirmation exception and is validated but not normalized into any durable identifier; it is not accepted as cancellation authority; and
- explicit `Confirmation` / `Cancellation` / `OfferStatus` type discriminators on relevant Stays evidence must agree with the documented hospitality object family.

This preserves multi-content compatibility without allowing a partial or contradictory hotel locator or cancellation signal to disappear silently next to a valid PNR. In particular, unrelated air confirmation/cancellation objects using `OfferStatusAir` remain outside Stays authority when they do not claim a Stays locator pair.

## Sync exception

Travelport's current Sync response example can omit `locatorType` from the confirmed Travelport receipt. SF keeps that exception narrowly scoped to `travelport-stays-reservation-sync-domain.ts`, which copies the provider payload and adds `PNR Locator` only for the documented Sync-only Travelport omission before calling the shared Create classifier. Explicit locator types are never rewritten.

The same documented Sync response includes a Booking.com supplier confirmation plus a separate Booking.com `Pin code`. The shared inspector accepts that PIN only as bounded auxiliary supplier evidence and continues to derive supplier confirmation authority solely from `Supplier + Confirmation Number`.

The shared receipt inspector itself remains strict, so these exceptions cannot accidentally broaden ordinary durable Create or Retrieve response authority.

## Privacy and durability

The normalized evidence contains only bounded provider locator, supplier locator, supplier source, and receipt status fields needed for lifecycle decisions. It does not retain Booking.com PIN values, raw provider responses, traveler data, payment-card data, credentials, tokens, or free-form provider messages.

Cancellation lifecycle evidence is used only to prevent an active-success classification. A self-identifying `ReceiptCancellation` reference is not promoted into provider-neutral durable reservation identity, retry authority, recovery authority, audit metadata, or logs.

Duplicate relevant locator receipts still fail closed at their calling boundary, including repeated identical locators. Receipt structure validation therefore complements rather than replaces the existing exact cardinality, confirmed-status, reservation-identity, supplier-confirmation continuity, and retry-safety rules.

## Validation

Focused tests cover shared normalization, supplier cancellation evidence, self-identifying Stays `ReceiptCancellation` normalization, unrelated shared-model cancellation compatibility, malformed/contradictory Stays cancellation rejection, reciprocal source-context/locator-family pairing, documented Booking.com `Supplier + Pin code` compatibility without durable promotion, malformed/foreign-context PIN rejection, explicit contradictory `ConfirmationHold` / `CancellationHold` / `OfferStatusHospitality` discriminator rejection, bounded unrelated multi-content compatibility, the documented Sync-only missing-locator-type exception, end-to-end Create/Retrieve malformed sibling rejection, and active Create/Retrieve cancellation rejection.

A dependency-free source contract requires Retrieve and Create/Sync to keep using the same inspector, protects the Travelport/Supplier/Agency locator-family rules including the narrow non-durable Booking.com PIN pair, requires Stays `ReceiptCancellation` to flow into the existing cancellation rejection boundary rather than being blindly skipped, protects explicit hospitality discriminator checks, and checks that payment-card/form-of-payment fields are not part of the normalized receipt module.

Full repository validation still requires the repository-supported Node 24/TypeScript 6 environment. PostgreSQL scenarios require an explicitly disposable target. Live Travelport verification requires provisioned non-production credentials and reviewed payment authority. GitHub Actions are not used.

## Provider references

- Travelport Hotel v11 Create Reservation Reference Payload: `Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm`
- Travelport Hotel v11 Retrieve Hotel Reservation: `Hotel11/APIReferences/APIRef_Retrieve.htm`
- Travelport Hotel v11 Cancel Hotel Reservation: `Hotel11/APIReferences/APIRef_Cancel.htm`
- Travelport Hotel v11 Sync Reservation: `Hotel11/APIReferences/APIRef_Sync.htm`
- Travelport shared Reservation Retrieve response model: `Air11/Book/APIRef_ReservationRetrieve.htm`
