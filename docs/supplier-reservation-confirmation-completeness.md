# Supplier reservation confirmation completeness

## Purpose

A successful external hotel sell is not operationally complete when SF has only the aggregator PNR and is missing the hotel supplier confirmation required for later lifecycle operations.

Travelport's current Stays Create Reservation documentation says a booking response returns three `ReceiptConfirmation` records: supplier, aggregator, and agency. The supplier receipt is the hotel's confirmation number and is required to cancel the booking. Travelport's Cancel Hotel Reservation API likewise requires the supplier locator from `locatorType=Confirmation Number` and `sourceContext=Supplier`.

SF therefore distinguishes provider sell evidence from complete durable reservation authority.

## Fresh Create settlement

The Travelport Create classifier can still normalize a valid Travelport PNR independently from the supplier locator because those are separate provider evidence families. The durable settlement bridge is stricter.

A fresh initial or reviewed Create can settle directly to `CONFIRMED` only when it has both:

- a validated Travelport PNR Locator; and
- a validated supplier Confirmation Number.

If Travelport returns a valid PNR but no supplier Confirmation Number, SF persists the operation as `AMBIGUOUS` with `SUPPLIER_CONFIRMATION_MISSING`. The known PNR is retained as non-secret provider evidence so SF does not lose the identity of a sell that may already exist. The missing supplier locator never makes the operation retryable and never authorizes another Create.

Both the initial Create and the one-time reviewed second Create use the same durable Travelport outcome mapper, so the rule applies to both paths without provider-specific logic leaking into the generic reservation ledger.

## Reconciliation

Known-locator reconciliation is allowed to retrieve the retained PNR. When the operation is ambiguous specifically because `SUPPLIER_CONFIRMATION_MISSING`, a `FOUND` result is not enough to promote the operation to `CONFIRMED` unless the provider also returns a supplier confirmation.

If the PNR exists but the supplier confirmation is still absent, reconciliation settles back to `AMBIGUOUS`, keeps the provider reference, retains the normalized missing-confirmation failure code, and can be attempted again later under the existing tenant-scoped reconciliation authority.

This requirement is deliberately keyed to the normalized missing-confirmation state. Other reconciliation flows retain their established semantics.

## Historical and cancelled reservations

This rule does not redefine Travelport Retrieve parsing globally. A historical or cancelled reservation can legitimately expose a Travelport PNR while the supplier receipt has changed to a cancellation-number locator. The Retrieve adapter may still use that PNR as evidence that the provider record exists.

The stricter supplier-confirmation requirement applies when SF is resolving a fresh Create that was prevented from becoming durable `CONFIRMED` specifically because its lifecycle authority was incomplete.

## Security and tenancy

No new browser or public API route is introduced. Existing supplier Create and reconciliation services continue to require server-side `booking:manage`, organization ownership, the exact active integration, credential version, and the `reservation` capability before provider access.

Only bounded provider/supplier references and normalized failure state are persisted. Provider payloads, traveler data, credentials, tokens, PAN/CVV, cardholder data, and payment secrets are not added to durable evidence or audit metadata.

## Validation and activation gates

Focused behavior tests cover the durable Create downgrade and the normalized recovery requirement. A dependency-free source contract verifies that the PNR is preserved for reconciliation and that a missing supplier confirmation cannot pass the `FOUND` reconciliation branch for an operation carrying `SUPPLIER_CONFIRMATION_MISSING`.

Travelport `reservation` remains disabled. This hardening does not replace the remaining activation gates: a reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034`, negative-lookup, and locator-less correlation/retry semantics.

GitHub Actions are not used for validation.

## References

- Travelport Create Reservation Reference Payload API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Cancel Hotel Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Cancel.htm
- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-stays-create-outcome-classification.md`
