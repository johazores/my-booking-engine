# Hospitality payment-history safety boundary

Hospitality commercial-amendment settlement reads must not make financial decisions from an unbounded or silently truncated `payment_transactions` collection.

## Bounded settlement read

`readHospitalityPaymentSettlementHistory` is the tenant + booking scoped read boundary for complete hospitality settlement history. It reads deterministic 100-row cursor pages by immutable transaction ID, validates that every returned row still belongs to the requested organization and booking, validates the database creation timestamp, and restores deterministic `createdAt` + ID chronology before returning settlement evidence.

The synchronous safety ceiling is 1,000 payment transactions for one booking. Exactly 1,000 rows are accepted only after a one-row overflow probe proves the history is complete. If another row exists, the reader fails closed instead of returning a partial ledger. A caller must treat an incomplete result as a settlement conflict and must not infer payment, refund, amendment-apply, or recovery authority from the truncated prefix.

`getHospitalityBookingCommercialAmendmentSettlementState` uses this reader inside its existing serializable transaction. The endpoint therefore preserves its tenant authorization and one-snapshot semantics while removing its previous unbounded `findMany` payment-ledger materialization.

## Expired amendment recovery guard

The expired-amendment mutation guard does not need the complete ledger: its decision is only whether any amendment-owned payment row is not definitively `FAILED`. That boundary now issues a tenant + booking + amendment scoped `findFirst` existence query with `status != FAILED` rather than loading every linked payment row and applying `.some()` in application memory.

This is intentionally different from settlement derivation. Existence decisions should query for existence; money decisions must read complete bounded settlement evidence and fail closed if completeness cannot be proven.

## Follow-on use

New hospitality payment-ledger decision paths should use a bounded complete-history reader or an equally strict query shaped to the exact decision. A raw unbounded `paymentTransaction.findMany` must not become financial authority merely because the current dataset is small.
