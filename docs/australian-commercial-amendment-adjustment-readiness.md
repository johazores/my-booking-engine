# Australian commercial-amendment adjustment readiness

## Purpose

SF has server-side readiness, issuance, read, PDF, accounting, reconciliation, and public-delivery contracts for the first Australian hospitality commercial-amendment decreasing adjustment. The cumulative foundation now also includes schema-version-3 immutable predecessor evidence, PostgreSQL predecessor-chain constraints, complete server-side chain verification, locked chain-head selection, and an internal repeated-write service.

Repeated issuance is still deliberately unreachable from the existing API/UI until all downstream reads and delivery projections validate the same complete chain.

## Authority

Readiness and issuance require `payment:manage`. Authenticated legal-document reads require `booking:read` plus `payment:read`.

All legal authority is derived from persisted tenant-scoped evidence. Browser input never supplies GST, amounts, currency, provider truth, settlement source, amendment direction, pricing fingerprints, sequence numbers, issue time, or predecessor authority.

## First decreasing adjustment

The reachable first adjustment succeeds only when the AU/AUD source tax invoice reconciles, the amendment is an applied `REFUND`, its before-price equals the immutable source invoice, its after-price equals exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` record, no earlier legal adjustment exists, standard GST reconciles before/after/decrease, and provider-neutral settlement is complete at the after-total.

`issueHospitalityCommercialAmendmentAdjustmentNote` persists schema version 2 / ordinal `1` evidence and remains the only commercial-adjustment service wired to the current API/UI.

## Cumulative readiness

For a second or later commercial decrease, `assessAustralianCommercialAmendmentAdjustmentReadiness` requires the complete verified predecessor set. It rejects missing evidence, count or ordinal gaps, duplicate identities/fingerprints, chronology regressions, non-standard-GST decreases, source-to-chain price drift, predecessor-to-predecessor price drift, next-amendment baseline drift, and an amendment applied before the immediate predecessor document.

A valid result contains the exact next `sourceAdjustmentOrdinal` and immediate predecessor identity required for schema-version-3 evidence.

## Persisted and verified chain

`HospitalityIssuedAdjustmentNote` carries `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal` for ordinal `2+` commercial documents. PostgreSQL enforces same-tenant/same-booking/same-source/same-reason predecessor authority, contiguous ordinals, no forks, and no self-predecessor.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the source tax invoice and complete persisted commercial chain in the caller transaction. Every adjustment snapshot is reparsed and fingerprinted; every referenced applied amendment and exact target pricing-evidence row is reloaded inside tenant + booking scope; target breakdowns must reconcile to material columns; and every predecessor pointer, frozen document identity, chronology, price transition, party fingerprint, and standard-GST decrease must agree. Mixed cancellation/commercial chains fail closed. The chain limit is 5,000 documents.

For writes, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` acquires a PostgreSQL transaction advisory lock keyed by tenant + booking + source invoice before reloading the verified chain head.

## Internal repeated issuance

`issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` now consumes that locked verified chain inside a serializable transaction. It is a real persistence boundary, not a simulated workflow.

The service requires at least one verified predecessor, rejects a different legal-adjustment reason, reloads the exact tenant-scoped amendment and single immutable target-pricing record, derives provider-neutral settlement from the complete booking payment ledger, and reruns cumulative readiness with `chain.priorAdjustments`.

Before allocating a number, the readiness result must agree exactly with the locked chain on next ordinal, predecessor id, predecessor document number, and predecessor document fingerprint. The service then allocates the shared Australian adjustment-note sequence, creates schema-version-3 immutable evidence with the exact predecessor head, persists predecessor id/ordinal material columns, and reloads the full chain. The write is accepted only if the new row becomes the verified head and the next expected ordinal advances by one.

The service is idempotent by commercial-amendment authority and writes the same safe adjustment-note issuance audit family used by the first adjustment.

## Reachability and next dependency

The current API route still imports `issueHospitalityCommercialAmendmentAdjustmentNote`; it does not expose the repeated service. Current tax-invoice availability also remains first-adjustment-only.

Staff/public adjustment reads, accounting/reconciliation, HTML, and PDF delivery continue to reject schema-version-3 rows. The next production slice is to make those downstream surfaces use complete chain verification. Once that is validated, availability and the API/UI can safely expose the repeated write service.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/PostgreSQL execution, and jurisdiction/legal review remain separate boundaries.
