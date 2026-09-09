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

The provider-neutral recovery contract can declare that its `FOUND` evidence is commercially incomplete without a supplier confirmation. Travelport declares this requirement because its current Stays lifecycle returns a supplier Confirmation Number for an active hotel reservation and requires that supplier locator for cancellation.

The reconciliation coordinator checks that provider-declared requirement before logging a successful `FOUND` observation or settling the durable operation. If Travelport retrieves the exact active PNR and stay but the supplier Confirmation Number is still absent, SF settles back to `AMBIGUOUS` with `SUPPLIER_CONFIRMATION_MISSING`, preserves the known provider identity, and can be reconciled again later. This applies regardless of which earlier ambiguity caused recovery; a transport-timeout ambiguity cannot bypass supplier-confirmation completeness merely because a later Retrieve finds the PNR.

Once SF already has a supplier confirmation, recovery cannot silently rotate or erase that lifecycle identifier. A `FOUND` result with a missing or different supplier confirmation fails closed as `SUPPLIER_CONFIRMATION_MISMATCH`; the existing provider/supplier identity remains durable, the operation stays ambiguous, and another Create is not authorized. Only a reservation that never had a supplier confirmation may acquire that previously absent lifecycle identifier during recovery.

A provider-neutral `NOT_FOUND` result is authoritative only when two supplier-confirmation conditions agree: SF has no durable supplier confirmation, and the runtime result itself presents no supplier-confirmation evidence. If SF already has a supplier confirmation, `NOT_FOUND` cannot clear the provider locator, clear the supplier confirmation, or return the operation to `PREPARED`. If SF has no durable supplier confirmation but a buggy/malformed runtime adapter nevertheless returns a non-null supplier confirmation alongside `NOT_FOUND`, that is also contradictory sell evidence and cannot authorize another Create. Both cases settle back to `AMBIGUOUS` with `SUPPLIER_CONFIRMATION_MISMATCH`; existing durable identifiers are preserved. Travelport currently does not treat a generic Hotel Retrieve HTTP 404 as authoritative negative evidence.

The confirmation-evidence rule remains shared by the coordinator and the durable reconciliation settlement service. Provider-declared `FOUND` completeness is checked by the coordinator before a success observation is emitted, while the ledger independently protects durable supplier identity and the normalized missing-confirmation state. This keeps Travelport-specific lifecycle requirements behind the adapter contract instead of branching on provider code inside the generic reconciliation service.

Recovered provider correlation and `FOUND` supplier-confirmation values are normalized before the reconciliation success path. For `NOT_FOUND`, the raw supplier-confirmation value is deliberately evaluated before optional-value normalization so an unexpected blank/non-canonical field cannot disappear into clean negative authority.

## Active versus historical provider records

The low-level Travelport response parser can normalize a historical PNR without granting commercial recovery authority. That capability is useful for bounded provider-record inspection and does not mean a cancelled reservation is still active.

Fresh-Create reconciliation is stricter. Before the Travelport recovery adapter may participate in provider-neutral `FOUND` settlement, the Travelport PNR receipt must be `Confirmed`, every supplier Confirmation Number receipt that is presented must be `Confirmed`, explicit supplier `Cancellation Number` evidence is rejected, and the adapter declares that a supplier Confirmation Number is mandatory for final `FOUND` authority. Travelport documents that a cancellation response changes the supplier receipt to `Cancellation Number` / `Cancelled` while the Travelport PNR receipt can remain `Confirmed`, so the aggregator PNR alone cannot prove a complete active hotel reservation.

This keeps historical record-existence parsing separate from the state transition that can settle an uncertain external sell as `CONFIRMED`. A cancelled, unconfirmed, or supplier-confirmation-incomplete Retrieve remains fail-closed through the recovery coordinator and cannot authorize another Create.

## Security and tenancy

No new browser or public API route is introduced. Existing supplier Create and reconciliation services continue to require server-side `booking:manage`, organization ownership, the exact active integration, credential version, and the `reservation` capability before provider access.

Only bounded provider/supplier references and normalized failure state are persisted. Provider payloads, traveler data, credentials, tokens, PAN/CVV, cardholder data, and payment secrets are not added to durable evidence or audit metadata.

## Validation and activation gates

Focused behavior and dependency-free contract coverage now check fresh Create completeness, provider-declared recovery completeness, immutable known supplier confirmation identity, contradictory `NOT_FOUND` evidence, and the active-state requirement that cancelled/unconfirmed Travelport Retrieve evidence cannot become durable `CONFIRMED`. The Travelport recovery adapter declares the supplier-confirmation requirement through the provider-neutral recovery interface, and the coordinator enforces it before provider success observation and durable `FOUND` settlement.

Database integration coverage distinguishes three negative-recovery outcomes: a durable supplier confirmation keeps the operation ambiguous; a runtime `NOT_FOUND` result that itself carries supplier-confirmation evidence also stays ambiguous even when SF had no stored supplier confirmation; and a clean operation/result pair with no supplier confirmation may still become `PREPARED` after authoritative provider-neutral `NOT_FOUND` evidence. These database-backed scenarios require the explicitly disposable PostgreSQL test target before they can be claimed as executed.

Travelport `reservation` remains disabled. This hardening does not replace the remaining activation gates: a reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034`, negative-lookup, and locator-less correlation/retry semantics.

GitHub Actions are not used for validation.

## References

- Travelport Create Reservation Reference Payload API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_CreateReservationRefPayload.htm
- Travelport Retrieve Hotel Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Retrieve.htm
- Travelport Cancel Hotel Reservation API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_Cancel.htm
- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-stays-create-outcome-classification.md`
- `docs/supplier-reservation-recovery-identity.md`
