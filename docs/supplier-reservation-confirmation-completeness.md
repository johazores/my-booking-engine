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

Once SF already has a supplier confirmation, recovery cannot silently rotate or erase that lifecycle identifier. A `FOUND` result with a missing or different supplier confirmation fails closed as `SUPPLIER_CONFIRMATION_MISMATCH`; the existing provider/supplier identity remains durable, the operation stays ambiguous, and another Create is not authorized. Only the missing-confirmation state may acquire a previously absent supplier confirmation during recovery.

A provider-neutral `NOT_FOUND` result is authoritative only when two supplier-confirmation conditions agree: SF has no durable supplier confirmation, and the runtime result itself presents no supplier-confirmation evidence. If SF already has a supplier confirmation, `NOT_FOUND` cannot clear the provider locator, clear the supplier confirmation, or return the operation to `PREPARED`. If SF has no durable supplier confirmation but a buggy/malformed runtime adapter nevertheless returns a non-null supplier confirmation alongside `NOT_FOUND`, that is also contradictory sell evidence and cannot authorize another Create. Both cases settle back to `AMBIGUOUS` with `SUPPLIER_CONFIRMATION_MISMATCH`; existing durable identifiers are preserved. Travelport currently does not treat a generic Hotel Retrieve HTTP 404 as authoritative negative evidence.

The confirmation-evidence rule is shared by the coordinator and the durable reconciliation settlement service. The coordinator inspects raw runtime `NOT_FOUND` supplier-confirmation evidence before an info-level success observation can be emitted. The ledger independently repeats that check before it can clear the provider locator or restore `PREPARED`. This defense in depth means a direct server-side/runtime settlement call cannot bypass supplier-confirmation completeness or identity continuity even if a future caller does not use the current coordinator correctly.

Recovered provider correlation and `FOUND` supplier-confirmation values are normalized before the reconciliation success path. For `NOT_FOUND`, the raw supplier-confirmation value is deliberately evaluated before optional-value normalization so an unexpected blank/non-canonical field cannot disappear into clean negative authority.

## Historical and cancelled reservations

This rule does not redefine Travelport Retrieve parsing globally. A historical or cancelled reservation can legitimately expose a Travelport PNR while the supplier receipt has changed to a cancellation-number locator. The Retrieve adapter may still use that PNR as evidence that the provider record exists.

The stricter supplier-confirmation requirement applies when SF is resolving a fresh Create that was prevented from becoming durable `CONFIRMED` specifically because its lifecycle authority was incomplete, or when an already-known supplier confirmation is part of the durable ambiguous reservation identity.

## Security and tenancy

No new browser or public API route is introduced. Existing supplier Create and reconciliation services continue to require server-side `booking:manage`, organization ownership, the exact active integration, credential version, and the `reservation` capability before provider access.

Only bounded provider/supplier references and normalized failure state are persisted. Provider payloads, traveler data, credentials, tokens, PAN/CVV, cardholder data, and payment secrets are not added to durable evidence or audit metadata.

## Validation and activation gates

Focused behavior tests cover the durable Create downgrade, the normalized missing-confirmation recovery requirement, immutable known supplier confirmation identity, and the rule that contradictory `NOT_FOUND` evidence cannot come from either durable supplier identity or the runtime recovery result. Dependency-free source contracts verify that the same evidence rule runs before provider success observations and again at durable reconciliation settlement.

Database integration coverage distinguishes three negative-recovery outcomes: a durable supplier confirmation keeps the operation ambiguous; a runtime `NOT_FOUND` result that itself carries supplier-confirmation evidence also stays ambiguous even when SF had no stored supplier confirmation; and a clean operation/result pair with no supplier confirmation may still become `PREPARED` after authoritative provider-neutral `NOT_FOUND` evidence. These database-backed scenarios require the explicitly disposable PostgreSQL test target before they can be claimed as executed.

Travelport `reservation` remains disabled. This hardening does not replace the remaining activation gates: a reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034`, negative-lookup, and locator-less correlation/retry semantics.

GitHub Actions are not used for validation.

## References

- Travelport Create Reservation Reference Payload API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Cancel Hotel Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Cancel.htm
- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-stays-create-outcome-classification.md`
- `docs/supplier-reservation-recovery-identity.md`
