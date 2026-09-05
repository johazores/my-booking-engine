# Australian commercial-amendment adjustment readiness

## Purpose

SF has server-side readiness, issuance, read, PDF, accounting, reconciliation, and public-delivery contracts for first/repeated Australian hospitality commercial-amendment decreasing adjustments. The product shares a direction-aware commercial-adjustment boundary with supported increasing adjustments, so a supported commercial chain may alternate directions when every step satisfies the narrow AU/AUD fully taxable standard-GST authority contract.

A later full booking cancellation is a separate terminal schema-version-6 legal event; it is never treated as a commercial amendment.

## Authority

Readiness and issuance require `payment:manage`. Authenticated legal-document reads require `booking:read` plus `payment:read`. Legal authority is derived from persisted tenant-scoped evidence. Browser input never supplies GST, amounts, currency, provider truth, direction, pricing fingerprints, sequence, issue time, source ordinal, or predecessor authority.

## Decreasing readiness contract

`assessAustralianCommercialAmendmentAdjustmentReadiness` accepts only AU/AUD fully taxable standard-GST decreasing `REFUND` amendments that are already `APPLIED` and whose provider-neutral settlement reconciles exactly to the applied after-total.

For the first adjustment, the amendment before-price must exactly equal the immutable source tax invoice and the after-price must equal exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record.

For a later decrease, the complete verified predecessor set must be contiguous, unique, chronologically monotonic, standard-GST, and price-continuous from the source invoice through the new amendment before-price. A predecessor may be decreasing or increasing; its direction/schema authority is proved before readiness receives the chain.

## Persisted and verified chain

`HospitalityIssuedAdjustmentNote` carries predecessor ID/ordinal for ordinal `2+` commercial documents. PostgreSQL enforces same-tenant/same-booking/same-source predecessor authority, contiguous ordinals, no forks, and no self-predecessor.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reparses/fingerprints commercial schema versions 2 through 5 and reloads the source invoice, applied amendments, target-pricing records, chronology, and settlement under tenant + booking scope. The commercial chain limit is 5,000 documents. Repeated writes use a transaction advisory lock keyed by tenant + booking + source invoice before reloading the head.

For historical reads, the loader can tolerate exactly one structurally terminal schema-version-6 booking cancellation after the final commercial row. That row is not a commercial chain member. The locked write selector does not enable terminal tolerance, so commercial writes remain closed once a cancellation exists.

## Product availability and issuance

Commercial orchestration derives the current legal baseline from the complete verified chain head and exposes only one unambiguous eligible current-baseline amendment. Decreasing writes use schema version 2 for ordinal `1` and schema version 3 for ordinal `2+`; increasing writes use schemas 4 and 5.

Same-baseline ambiguity is bounded by the verified current chain-head issue time so stale earlier amendments cannot become current authority merely because a later chain returns to the same price.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` requires the requested route amendment ID to equal the unique server-derived candidate. The route request body contains only `sourceInvoiceDocumentNumber`; browser input cannot select writer, direction, ordinal, or predecessor.

## Terminal cancellation convergence

`getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability` may expose a terminal cancellation only after the complete commercial head verifies and issue-time provider-neutral refund settlement reduces the current legal price exactly to zero. `issueHospitalityCancellationAfterAmendmentAdjustmentNote` then persists schema-version-6 predecessor-bound evidence under the same source-chain serialization boundary.

Historical staff/public commercial reads remain valid after that terminal event, while the terminal document itself is independently verified through its frozen refund-authority set.

## Read and delivery convergence

Staff detail/register/accounting/reconciliation reads and public capability history accept commercial schema-version-2-through-5 documents only through the shared complete chain authority. Public ownership is verified before chain loading, and customer-safe projections omit internal predecessor/amendment/target authority.

Authenticated/public HTML and deterministic PDF routes reuse the verified shared adjustment-document boundary, including schema-version-6 cancellation documents.

## Remaining boundaries

Mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review remain separate contracts.
