# Hospitality payment-history safety boundary

Hospitality payment-ledger money decisions must not rely on an unbounded or silently truncated `payment_transactions` collection. The same complete-history rule applies to commercial-amendment settlement and normal booking refund authority.

## Bounded settlement read

`readHospitalityPaymentSettlementHistory` is the tenant + booking scoped read boundary for complete hospitality settlement history. It reads deterministic 100-row cursor pages by immutable transaction ID, validates that every returned row still belongs to the requested organization and booking, validates the database creation timestamp, and restores deterministic `createdAt` + ID chronology before returning settlement evidence.

The synchronous safety ceiling is 1,000 payment transactions for one booking. Exactly 1,000 rows are accepted only after a one-row overflow probe proves the history is complete. If another row exists, the reader fails closed instead of returning a partial ledger. A caller must treat an incomplete result as a settlement conflict and must not infer payment, refund, amendment-apply, or recovery authority from the truncated prefix.

`getHospitalityBookingCommercialAmendmentSettlementState` uses this reader inside its existing serializable transaction. The authenticated commercial-amendment transport read uses the same complete bounded evidence before deriving settlement, refund allocation, or executable state. The commercial-amendment apply mutation also requires complete bounded settlement history before it can consider settlement ready and change booking commercial terms, inventory allocation, or amendment state. The post-apply-failure recovery boundary likewise requires a complete bounded ledger before `READY_TO_APPLY` can grant recovery authority, release protected inventory, or shorten the recovery lifetime. An incomplete history is a conflict in each of these paths, never an invitation to infer money state from a prefix. These boundaries therefore preserve their existing tenant authorization and transactional semantics while removing unbounded payment-ledger materialization.

Commercial-amendment preparation now requires the same complete bounded history before it can prove that the paid booking reconciles to its authoritative total and select the amendment payment provider. The manual settlement writer also fails closed before recording a new external payment or refund if complete booking payment history cannot be proven. Stripe amendment refunds use the bounded history before creating a new provider claim or retrying an internal claim, while already-terminal idempotent results and provider-bound ambiguous refunds remain readable without re-deriving allocation from the entire ledger. This keeps provider calls behind their adapters while ensuring new money movement is never authorized from a truncated booking history.

## Normal booking refund authority

Normal booking refunds use the same complete settlement boundary instead of materializing the full booking ledger with a raw `paymentTransaction.findMany`. Refund availability fails closed when complete tenant + booking history cannot be proven, so the UI/API cannot advertise refundable authority from a truncated prefix. Manual offline refund execution also requires complete history before selecting its source payment, allocating the amount, recording the external refund reference, or mutating booking payment state.

Direct Stripe refund execution requires complete bounded history before creating or retrying an internal provider claim. After a successful provider response, it reads complete history again inside the serializable persistence transaction before changing booking payment state. Explicit Stripe refund reconciliation likewise validates complete history before the provider lookup and again after booking/payment locks before applying provider truth. The verified Stripe refund lifecycle path also requires complete history before changing refund or booking state. These checks keep provider reads and calls behind their existing adapters while preventing incomplete ledger evidence from authorizing money movement or lifecycle mutation.

The primary signed Stripe refund ingestion callback uses the same complete bounded settlement history before deriving refund allocation and re-reads complete history after the refund row is updated before changing booking payment state. If either bounded read cannot prove completeness, the surrounding Serializable webhook transaction throws and rolls back both the commercial mutation and webhook-event persistence; the provider callback is therefore not falsely acknowledged and can retry. The source-settlement lookup and pending-refund candidate search remain bounded exact-identity queries because they establish ownership and candidate identity rather than derive whole-ledger money authority.

Exact provider-reference lookups, bounded webhook candidate searches, and duplicate-reference existence queries remain shaped to the identity decision they answer; they are not substitutes for settlement derivation. The operator-facing paginated transaction listing also keeps its explicit page-size contract because it is a presentation read rather than financial authority.

## Bounded recovery payment history

Commercial-amendment compensation has a stricter evidence shape than ordinary settlement. `readHospitalityPaymentRecoveryHistory` owns that tenant + booking scoped contract. It keeps the same deterministic 100-row cursor pagination and 1,000-row fail-closed ceiling, but also preserves `idempotencyKey` and `requestFingerprint` so provider recovery claims can prove exact operation identity instead of re-deriving money authority from an incomplete prefix.

Manual recovery, direct Stripe recovery, and customer-authorized Stripe recovery Checkout all require this complete bounded recovery history before they can derive compensation, retry a provider claim, create another money-moving claim, or close the expired amendment. The reader validates every returned tenant and booking identity plus persisted chronology before returning evidence. If the ceiling is exceeded or scope/chronology cannot be proven, these flows return a conflict and do not call a provider or write another payment transaction.

This recovery reader is intentionally separate from the settlement-only reader. Recovery needs richer idempotency/fingerprint evidence, while ordinary settlement should not acquire extra authority fields it does not use. Exact transaction lookups, provider-reference uniqueness checks, and bounded amendment-scoped candidate queries remain shaped to their own decisions rather than being replaced by a whole-ledger reader.

## Bounded legal-document payment evidence

Australian legal-document authority uses `readHospitalityLegalPaymentEvidenceHistory` instead of an unbounded whole-booking ledger read. This contract reads deterministic 100-row cursor pages under tenant + booking scope, validates persisted chronology, restores `createdAt` + ID order, and fails closed above 5,000 payment transactions. The higher ceiling is deliberate because legal history may span a long-lived booking and multiple immutable adjustment documents; it is still a hard synchronous safety boundary, not permission to accept a partial prefix.

Current commercial-adjustment legal settlement authority uses this reader consistently across first and repeated adjustment readiness, product availability/orchestration, and issuance for both decreasing and increasing amendments. Each path requires a complete tenant + booking evidence set before deriving commercial-amendment settlement; an overflow or scope/chronology failure becomes a persistence/conflict boundary before a legal document can be advertised as ready or issued. This prevents one legal surface from accepting a truncated payment prefix while another rejects it.

The reader can also freeze the database query at an exact `through` timestamp. Commercial adjustment-chain verification loads complete legal payment evidence only through the latest commercial document issue time, then replays each chain step against its own earlier issue time. Schema-version-6 cancellation availability uses complete current legal payment evidence, while post-issuance schema-version-6 verification reads complete evidence only through the immutable cancellation issue time. If any of those reads cannot prove completeness, legal readiness or verification fails closed instead of deriving document authority from truncated payment history.

This legal-evidence reader is intentionally separate from the 1,000-row operational settlement and recovery readers. Legal verification needs a durable issue-time horizon and a lifecycle-wide evidence ceiling; operational money movement should retain its tighter synchronous guard. Provider-specific APIs remain outside the legal-document contract.

## Expired amendment recovery guard

The expired-amendment mutation guard does not need the complete ledger: its decision is only whether any amendment-owned payment row is not definitively `FAILED`. That boundary now issues a tenant + booking + amendment scoped `findFirst` existence query with `status != FAILED` rather than loading every linked payment row and applying `.some()` in application memory.

This is intentionally different from settlement derivation. Existence decisions should query for existence; money decisions must read complete bounded settlement evidence and fail closed if completeness cannot be proven.

## Follow-on use

New hospitality payment-ledger decision paths should use a bounded complete-history reader or an equally strict query shaped to the exact decision. A raw unbounded `paymentTransaction.findMany` must not become financial authority merely because the current dataset is small. Legal-document issuance and verification must use the dedicated bounded legal-evidence contract or another explicit complete evidence boundary rather than silently accepting a truncated prefix.
