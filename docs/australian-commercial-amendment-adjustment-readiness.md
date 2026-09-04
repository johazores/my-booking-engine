# Australian commercial-amendment adjustment readiness

## Purpose

SF has server-side readiness, issuance, read, PDF, accounting, reconciliation, and public-delivery contracts for first and repeated Australian hospitality commercial-amendment decreasing adjustments. Repeated documents use the same immutable source invoice and a verified linear predecessor chain; no browser or provider response can invent the legal baseline.

## Authority

Readiness and issuance require `payment:manage`. Authenticated legal-document reads require `booking:read` plus `payment:read`.

All legal authority is derived from persisted tenant-scoped evidence. Browser input never supplies GST, amounts, currency, provider truth, settlement source, amendment direction, pricing fingerprints, sequence numbers, issue time, source ordinal, or predecessor authority.

## Readiness contract

`assessAustralianCommercialAmendmentAdjustmentReadiness` accepts only AU/AUD fully taxable standard-GST decreasing `REFUND` amendments that are already `APPLIED` and whose provider-neutral settlement reconciles exactly to the applied after-total.

For the first adjustment, the amendment before-price must exactly equal the immutable source tax invoice and its after-price must equal exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record.

For a second or later adjustment, the caller must supply the complete verified predecessor set. The chain must be contiguous from ordinal `1`, unique by adjustment/document identity and fingerprint, chronologically monotonic, standard-GST decreasing at every step, price-continuous from the source invoice through every predecessor, and end exactly at the new amendment before-price. A valid result returns the exact next `sourceAdjustmentOrdinal` and immediate predecessor identity.

## Persisted and verified chain

`HospitalityIssuedAdjustmentNote` carries `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal` for ordinal `2+` commercial documents. PostgreSQL enforces same-tenant/same-booking/same-source/same-reason predecessor authority, contiguous ordinals, no forks, and no self-predecessor.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the source tax invoice and complete persisted commercial chain in the caller transaction. Every adjustment snapshot is reparsed and fingerprinted; every referenced applied amendment and exact target pricing-evidence row is reloaded inside tenant + booking scope; target breakdowns must reconcile to material columns; and every predecessor pointer, frozen document identity, chronology, price transition, party fingerprint, and standard-GST decrease must agree. Mixed cancellation/commercial chains fail closed. The chain limit is 5,000 documents.

For writes, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` acquires a PostgreSQL transaction advisory lock keyed by tenant + booking + source invoice before reloading the verified chain head.

## Chain-aware availability

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` is the product-facing readiness adapter. It derives the legal baseline from the complete verified chain, searches only tenant-owned applied `REFUND` amendments beginning at that baseline, and refuses zero or multiple matching candidates. It then revalidates the single immutable target-pricing record, derives settlement from the complete booking payment ledger, and calls the pure readiness contract with the full verified predecessor set.

The returned source ordinal is server-derived. For repeated availability, readiness predecessor id/document/fingerprint must match the current verified head exactly. The UI can display the next ordinal and latest document number, but neither value is accepted back as authority.

## Reachable issuance

`issueHospitalityCommercialAmendmentAdjustmentNote` persists schema version 2 / ordinal `1`. `issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` persists schema version 3 / ordinal `2+` after locking and revalidating the complete source chain.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` is the reachable orchestration boundary used by the existing amendment adjustment-note API. Before a new write it requires the request amendment id to equal the unique chain-derived availability candidate. For exact retries, it first proves the existing issued document belongs to the verified source chain and routes back to the correct idempotent first/repeated writer. The browser never selects which writer or ordinal is used.

The repeated writer rechecks the locked chain, complete provider-neutral settlement and cumulative readiness, allocates the shared Australian adjustment-note sequence, creates schema-version-3 immutable predecessor evidence, persists relational predecessor authority, and reloads the complete chain before commit. The new row must be the verified head and advance the expected ordinal exactly once.

## Read and delivery convergence

Staff detail/register/accounting/reconciliation reads and public booking-capability history now accept schema version 3 only through complete chain verification. Public capability ownership is verified before chain loading, and customer-safe projections omit internal predecessor ids/fingerprints and amendment/target ids.

Authenticated/public HTML and deterministic PDF routes reuse those read boundaries. Repeated legal documents therefore cannot be issued through the reachable product without also being independently verifiable and deliverable afterward.

## Remaining boundaries

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review remain separate contracts.
