# Travelport Stays receipt evidence

## Purpose

SF treats Travelport reservation receipts as commercial identity evidence, not as loosely typed metadata. The same provider-specific receipt inspection boundary is used by known-locator Hotel Retrieve and by the Create/Booking.com Sync commercial outcome classifier so malformed or contradictory receipt structure cannot be ignored beside one otherwise valid locator.

This boundary does not enable the Travelport `reservation` capability. It only strengthens response interpretation for already-implemented server-only reservation lifecycle work. Activation still depends on the separately documented PCI-safe payment/guarantee source and live non-production provider verification.

## Stays locator authority

Travelport's current Hotel Create/Retrieve response examples use `ReceiptConfirmation` entries for the hotel locator families that SF needs:

- Travelport `PNR Locator` with `sourceContext=Travelport`;
- supplier `Confirmation Number` with `sourceContext=Supplier`; and
- agency `IATA Number` with `sourceContext=Agency`.

SF normalizes only the first two as durable reservation identifiers. Supplier `Cancellation Number` is tracked separately as lifecycle evidence and cannot be mistaken for the supplier confirmation.

The shared inspector requires the receipt collection to be bounded and every receipt entry to be structurally readable. A Stays confirmation that partially presents `sourceContext`/`locatorType`, has malformed locator/status/source text, omits a required Stays locator field, or pairs a Stays source context with the wrong locator family fails closed. Travelport authority is only `Travelport + PNR Locator`; Supplier authority is only `Supplier + Confirmation Number` or `Supplier + Cancellation Number`; Agency evidence is only `Agency + IATA Number`. The pairing is reciprocal: a canonical Stays locator type presented under a foreign source context also fails closed. This prevents contradictory provider-owned locator metadata from disappearing as if it were unrelated multi-content evidence.

Travelport's current Hotel Create, Retrieve, Cancel, and Sync examples also identify Stays confirmation structure with `Confirmation.@type=ConfirmationHold`, and active/cancelled hotel status evidence with `OfferStatus.@type=OfferStatusHospitality`. SF therefore rejects an explicitly present conflicting or malformed inner discriminator before that receipt can become Stays locator authority. A canonical Stays locator cannot be promoted from an object that explicitly identifies its confirmation or status as another content family. Omitted inner discriminators remain tolerated for backward/provider-shape compatibility; they do not create authority by themselves and all existing locator-pair, status, cardinality, reservation-identity, and lifecycle checks still apply.

Create/Sync also rejects any supplier cancellation evidence because a cancelled supplier lifecycle cannot prove an active successful write. Active known-locator recovery applies the same cancellation rejection before returning provider-neutral `FOUND`.

## Multi-content compatibility

Travelport's shared reservation model can also contain non-hotel receipt families such as `ReceiptPayment`, `ReceiptCancellation`, and confirmation locators owned by other content such as OrderId/VendorLocator. Those records are not relabeled as Stays reservation authority.

SF therefore distinguishes unrelated bounded multi-content evidence from malformed Stays evidence:

- bounded `ReceiptPayment` and `ReceiptCancellation` records are ignored by the Stays locator inspector;
- a generic confirmation locator with neither Stays `sourceContext` nor `locatorType` is ignored;
- a non-Stays source context without `locatorType` can remain outside Stays authority;
- Travelport, Supplier, or Agency Stays contexts cannot omit `locatorType`, and a locator type cannot be presented without its source context;
- recognized Stays source contexts and recognized Stays locator types must form one of the canonical pairs rather than being silently ignored when either side is contradictory; and
- explicit `Confirmation` / `OfferStatus` type discriminators on canonical Stays locator evidence must agree with the documented hospitality object family.

This preserves multi-content compatibility without allowing a partial or contradictory hotel locator to disappear silently next to a valid PNR. In particular, unrelated air confirmation objects using `OfferStatusAir` remain outside Stays authority when they do not claim a Stays locator pair.

## Sync exception

Travelport's current Sync response example can omit `locatorType` from the confirmed Travelport receipt. SF keeps that exception narrowly scoped to `travelport-stays-reservation-sync-domain.ts`, which copies the provider payload and adds `PNR Locator` only for the documented Sync-only Travelport omission before calling the shared Create classifier. Explicit locator types are never rewritten.

The shared receipt inspector itself remains strict, so the exception cannot accidentally broaden ordinary Create or Retrieve response authority.

## Privacy and durability

The normalized evidence contains only bounded provider locator, supplier locator, supplier source, and receipt status fields needed for lifecycle decisions. It does not retain raw provider responses, traveler data, payment-card data, credentials, tokens, or free-form provider messages.

Duplicate relevant locator receipts still fail closed at their calling boundary, including repeated identical locators. Receipt structure validation therefore complements rather than replaces the existing exact cardinality, confirmed-status, reservation-identity, supplier-confirmation continuity, and retry-safety rules.

## Validation

Focused tests cover shared normalization, supplier cancellation evidence, malformed/partial Stays receipt rejection, reciprocal canonical source-context/locator-family pairing, explicit contradictory `ConfirmationHold` / `OfferStatusHospitality` discriminator rejection, bounded unrelated multi-content compatibility, the documented Sync-only missing-locator-type exception, end-to-end Create/Retrieve malformed sibling rejection, and active Create/Retrieve cancellation rejection.

A dependency-free source contract requires Retrieve and Create/Sync to keep using the same inspector, protects the canonical Travelport/Supplier/Agency locator-family allowlist and explicit hospitality discriminator checks, and checks that payment-card/form-of-payment fields are not part of the normalized receipt module.

Full repository validation still requires the repository-supported Node 24/TypeScript 6 environment. PostgreSQL scenarios require an explicitly disposable target. Live Travelport verification requires provisioned non-production credentials and reviewed payment authority. GitHub Actions are not used.

## Provider references

- Travelport Hotel v11 Create Reservation Reference Payload: `Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm`
- Travelport Hotel v11 Retrieve Hotel Reservation: `Hotel11/APIReferences/APIRef_Retrieve.htm`
- Travelport Hotel v11 Cancel Hotel Reservation: `Hotel11/APIReferences/APIRef_Cancel.htm`
- Travelport Hotel v11 Sync Reservation: `Hotel11/APIReferences/APIRef_Sync.htm`
- Travelport shared Reservation Retrieve response model: `Air11/Book/APIRef_ReservationRetrieve.htm`
