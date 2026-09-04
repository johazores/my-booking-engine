# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian decreasing-adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with its own immutable evidence; SF does not provide a generic staff-entered credit-note workflow.

The supported issued contract remains AU/AUD and fully taxable standard GST. A first increasing commercial-amendment readiness contract now exists server-side, but increasing adjustment-note persistence and issuance are not yet exposed.

## Supported issued events

### Booking cancellation

`BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching the source invoice total/currency, a persisted settlement-source reference, and exact standard-GST reconciliation. The schema-version-1 document freezes the `refundTransactionId` as legal authority and remains ordinal `1`.

A cancellation adjustment cannot be mixed into an existing commercial-amendment chain. The current product continues to fail closed rather than invent cancellation-after-amendment tax semantics.

### Commercial amendments

The first issued `COMMERCIAL_AMENDMENT` requires the source tax invoice to equal the amendment frozen before-price, one exact applied `REFUND` amendment, exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row matching the after-price, exact standard GST, complete provider-neutral settlement at the after-total, valid chronology, and no earlier legal adjustment against the source invoice. It uses schema version 2 / ordinal `1`.

A second or later decreasing commercial amendment uses schema version 3 / ordinal `2+`. Its amendment before-price must equal the verified predecessor adjustment after-price, and its immutable document evidence binds the immediate predecessor adjustment-note id, source ordinal, document number, issue time, document fingerprint, and predecessor after-pricing fingerprint.

## Increasing commercial-amendment readiness

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` and `assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` now define a fail-closed server readiness boundary for the first `ADDITIONAL_CHARGE` amendment against an issued Australian tax invoice. The pure contract requires exact source-before and target-after pricing evidence, positive fully taxable standard-GST effect, applied chronology, complete provider-neutral settlement, and zero earlier adjustment notes. The service requires `payment:manage` and reloads all legal/commercial evidence inside tenant + booking scope.

No increasing adjustment note is persisted or exposed yet. Current database material columns and immutable commercial snapshots are decrease-specific, and the current predecessor-chain validator requires every persisted commercial step to be a decrease. SF will not reuse those decrease fields for an increasing legal document. See `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`.

## Persistence and database integrity

`HospitalityIssuedAdjustmentNote` persists `predecessorAdjustmentNoteId`, `predecessorSourceAdjustmentOrdinal`, and `sourceAdjustmentOrdinal` for repeated commercial decreases.

PostgreSQL preserves existing cancellation and first-commercial rows while enforcing same organization, booking, original source invoice, reason, and exact previous ordinal through the predecessor self-reference; `predecessorSourceAdjustmentOrdinal = sourceAdjustmentOrdinal - 1`; no self-predecessor; one successor per predecessor; ordinal `1` rows without predecessor authority; and schema-version-3 commercial rows with ordinal `2+` and predecessor authority.

## Complete chain verification

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` independently reloads the source invoice, all adjustment rows for that source, every applied commercial amendment, and every exact target pricing-evidence row inside the caller transaction and tenant/booking scope.

The chain validator requires row/snapshot/material agreement, canonical document fingerprints, contiguous ordinals, exact predecessor identity and frozen predecessor document evidence, source/predecessor-to-amendment price continuity, target-pricing agreement, valid chronology, party-fingerprint continuity, and exact standard-GST decrease reconciliation. Mixed cancellation/commercial history fails closed. Validation is bounded to 5,000 adjustment documents per source invoice.

For a write, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` first acquires a PostgreSQL transaction advisory lock for the tenant + booking + source invoice and then reloads the verified chain.

## Reachable issuance

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` derives the current legal baseline from the verified decreasing chain and requires exactly one unambiguous applied decreasing amendment to match it. It then reloads the exact target pricing evidence, derives settlement from the complete provider-neutral booking payment ledger, reruns cumulative readiness, and requires readiness ordinal/predecessor identity to equal the verified chain.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` is the reachable decreasing-adjustment API boundary. The server chooses the first or repeated writer from verified persisted state; the browser cannot supply the ordinal, predecessor, GST, amounts, provider truth, pricing fingerprints, sequence, or issue time. Exact retries for already-issued amendment authority remain idempotent after the existing document is re-proven as a member of the verified source chain.

The repeated writer acquires the chain advisory lock, reruns cumulative readiness inside its serializable transaction, creates schema-version-3 evidence from the locked predecessor head, persists relational predecessor authority, and reloads the complete chain before commit. The new row must become the verified head.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require both `booking:read` and `payment:read`. Staff detail/register/accounting projections and tax-document reconciliation validate schema-version-3 rows through the complete commercial source chain instead of one-row amendment checks.

Public booking-capability history performs booking-capability ownership authorization first and then verifies the same complete commercial chain. Customer projections exclude internal predecessor ids/fingerprints, amendment ids, target-evidence ids, provider/payment references, actors, credentials, and secrets.

Authenticated and public deterministic PDF routes reuse those verified read boundaries, so repeated decreasing commercial adjustment notes are renderable under the same current lossless-text/AUD contract once issued. The PDF remains a deterministic read projection and never becomes issuance authority.

## Remaining production boundaries

Increasing adjustment-note persistence/issuance/delivery, cumulative or mixed-direction increasing semantics, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, and other jurisdictions remain unsupported and must fail closed.

Durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
