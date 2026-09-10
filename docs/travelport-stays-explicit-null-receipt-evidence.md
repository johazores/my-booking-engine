# Travelport Stays explicit-null receipt evidence

## Purpose

Travelport Stays reservation receipts can authorize durable provider reservation identity, supplier confirmation identity, or cancellation lifecycle state. SF therefore distinguishes a provider field that is genuinely omitted from a field that is explicitly present with JSON `null`.

This is a provider-adapter response-validation rule only. It does not change tenant authorization, persistence, retry policy, payment handling, provider capability advertisement, or any user-facing booking workflow.

## Authority rule

Within the shared Travelport Stays receipt inspector, explicit JSON `null` is malformed when it is supplied for a field that identifies or discriminates Stays receipt authority:

- `Locator.sourceContext`;
- `Locator.locatorType`;
- `Receipt.@type`;
- `Confirmation.@type` for a supported Stays confirmation locator;
- `Cancellation.@type` for relevant Stays cancellation evidence; and
- `OfferStatus.@type` for supported Stays confirmation or cancellation evidence.

Genuine field omission keeps the existing compatibility behavior. In particular, unrelated shared-model confirmation locators may omit both Stays identity fields and remain outside Stays authority, omitted inner type discriminators remain tolerated where the existing contract already permits omission, and the documented Booking.com Sync Travelport PNR omission of `locatorType` continues to be handled only by the narrow Sync normalizer before the shared inspector runs.

The rule is deliberately absent-not-null. A parsed Travelport JSON response cannot use an explicit `null` field as evidence that the provider omitted that field.

## Why this is required

Before this hardening, the shared inspector used `value !== undefined && value !== null` to determine whether `sourceContext` and `locatorType` were present. A malformed receipt such as `sourceContext: null` with no `locatorType` could therefore be classified as a generic multi-content omission and ignored beside an otherwise valid Travelport PNR. Similar null-as-omission behavior existed on relevant receipt type discriminators.

That is unsafe at a commercial response boundary because malformed provider-owned evidence must not disappear simply because another valid locator is present.

Travelport's current Hotel v11 Sync response uses concrete `ReceiptConfirmation`, `ConfirmationHold`, `OfferStatusHospitality`, `Supplier`, and `Confirmation Number` values for the supplier receipt. Its Travelport PNR genuinely omits `locatorType` while retaining `sourceContext=Travelport`; the Sync adapter already recognizes only that exact documented omission shape. Travelport's current Hotel Cancel response likewise uses concrete `ReceiptConfirmation`, `ConfirmationHold`, `OfferStatusHospitality`, `Supplier`, `Cancellation Number`, `Travelport`, and `PNR Locator` values. Neither documented compatibility shape relies on explicit JSON `null` for these authority fields.

## Multi-content compatibility

The shared reservation model also carries air and NDC receipt shapes. This change does not require every shared-model locator to become a Stays locator. A field that is actually absent remains absent, and the existing non-Stays source-context and locator-family rules continue to decide whether that record is unrelated evidence.

Only explicit null presentation is tightened. This preserves valid mixed-content reservations while preventing null-valued Stays identity or discriminator fields from being silently downgraded to omission.

## Validation

Focused dependency-free tests cover explicit-null confirmation locator identity, explicit-null cancellation locator identity, explicit-null receipt and inner hospitality discriminators, preserved omitted-inner-discriminator compatibility, and preserved generic shared-model omission compatibility.

The source contract also pins the absent-not-null checks at both confirmation and cancellation inspection paths and verifies that Create/Sync and known-locator Retrieve continue to share this inspector.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. PostgreSQL validation requires an explicitly disposable target. Live Travelport verification requires provisioned non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.

## Provider references

- Travelport Hotel v11 Sync Reservation: `Hotel11/APIReferences/APIRef_Sync.htm`
- Travelport Hotel v11 Cancel Hotel Reservation: `Hotel11/APIReferences/APIRef_Cancel.htm`
- `docs/travelport-stays-receipt-evidence.md`
