# Hospitality payment-history safety boundary

Hospitality commercial-amendment settlement reads must not make financial decisions from an unbounded or silently truncated `payment_transactions` collection.

## Bounded settlement read

`readHospitalityPaymentSettlementHistory` is the tenant + booking scoped read boundary for complete hospitality settlement history. It reads deterministic 100-row cursor pages by immutable transaction ID, validates that every returned row still belongs to the requested organization and booking, validates the database creation timestamp, and restores deterministic `createdAt` + ID chronology before returning settlement evidence.

The synchronous safety ceiling is 1,000 payment transactions for one booking. Exactly 1,000 rows are accepted only after a one-row overflow probe proves the history is complete. If another row exists, the reader fails closed instead of returning a partial ledger. A caller must treat an incomplete result as a settlement conflict and must not infer payment, refund, amendment-apply, or recovery authority from the truncated prefix.

`getHospitalityBookingCommercialAmendmentSettlementState` uses this reader inside its existing serializable transaction. The authenticated commercial-amendment transport read uses the same complete bounded evidence before deriving settlement, refund allocation, or executable state. The post-apply-failure recovery boundary also requires a complete bounded ledger before `READY_TO_APPLY` can grant recovery authority, release protected inventory, or shorten the recovery lifetime. An incomplete history is a conflict in each of these paths, never an invitation to infer money state from a prefix. These boundaries therefore preserve their existing tenant authorization and transactional semantics while removing unbounded payment-ledger materialization.

Commercial-amendment preparation now requires the same complete bounded history before it can prove that the paid booking reconciles to its authoritative total and select the amendment payment provider. The manual settlement writer also fails closed before recording a new external payment or refund if complete booking payment history cannot be proven. Stripe amendment refunds use the bounded history before creating a new provider claim or retrying an internal claim, while already-terminal idempotent results and provider-bound ambiguous refunds remain readable without re-deriving allocation from the entire ledger. This keeps provider calls behind their adapters while ensuring new money movement is never authorized from a truncated booking history.

## Bounded recovery payment history

Commercial-amendment compensation has a stricter evidence shape than ordinary settlement. `readHospitalityPaymentRecoveryHistory` owns that tenant + booking scoped contract. It keeps the same deterministic 100-row cursor pagination and 1,000-row fail-closed ceiling, but also preserves `idempotencyKey` and `requestFingerprint` so provider recovery claims can prove exact operation identity instead of re-deriving money authority from an incomplete prefix.

Manual recovery, direct Stripe recovery, and customer-authorized Stripe recovery Checkout all require this complete bounded recovery history before they can derive compensation, retry a provider claim, create another money-moving claim, or close the expired amendment. The reader validates every returned tenant and booking identity plus persisted chronology before returning evidence. If the ceiling is exceeded or scope/chronology cannot be proven, these flows return a conflict and do not call a provider or write another payment transaction.

This recovery reader is intentionally separate from the settlement-only reader. Recovery needs richer idempotency/fingerprint evidence, while ordinary settlement should not acquire extra authority fields it does not use. Exact transaction lookups, provider-reference uniqueness checks, and bounded amendment-scoped candidate queries remain shaped to their own decisions rather than being replaced by a whole-ledger reader.

## Expired amendment recovery guard

The expired-amendment mutation guard does not need the complete ledger: its decision is only whether any amendment-owned payment row is not definitively `FAILED`. That boundary now issues a tenant + booking + amendment scoped `findFirst` existence query with `status != FAILED` rather than loading every linked payment row and applying `.some()` in application memory.

This is intentionally different from settlement derivation. Existence decisions should query for existence; money decisions must read complete bounded settlement evidence and fail closed if completeness cannot be proven.

## Follow-on use

New hospitality payment-ledger decision paths should use a bounded complete-history reader or an equally strict query shaped to the exact decision. A raw unbounded `paymentTransaction.findMany` must not become financial authority merely because the current dataset is small. Legal-document issuance paths that need differently bounded evidence must keep their own explicit completeness contract rather than silently borrowing a truncated prefix.
