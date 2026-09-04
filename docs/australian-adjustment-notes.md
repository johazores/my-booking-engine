# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with its own immutable evidence; SF does not provide a generic staff-entered credit-note workflow.

The reachable issued contract remains AU/AUD, fully taxable standard GST, and decreasing effects. A first increasing commercial-amendment readiness plus immutable persistence foundation now exists, but increasing issuance and delivery are intentionally still closed.

## Supported issued events

### Booking cancellation

`BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching the source invoice total/currency, a persisted settlement-source reference, and exact standard-GST reconciliation. The schema-version-1 document freezes the `refundTransactionId` as legal authority and remains ordinal `1`.

A cancellation adjustment cannot be mixed into an existing commercial-amendment chain. The current product continues to fail closed rather than invent cancellation-after-amendment tax semantics.

### Decreasing commercial amendments

The first issued `COMMERCIAL_AMENDMENT` requires the source tax invoice to equal the amendment frozen before-price, one exact applied `REFUND` amendment, exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row matching the after-price, exact standard GST, complete provider-neutral settlement at the after-total, valid chronology, and no earlier legal adjustment against the source invoice. It uses schema version 2 / ordinal `1`.

A second or later decreasing commercial amendment uses schema version 3 / ordinal `2+`. Its amendment before-price must equal the verified predecessor adjustment after-price, and its immutable document evidence binds the immediate predecessor adjustment-note id, source ordinal, document number, issue time, document fingerprint, and predecessor after-pricing fingerprint.

## Increasing commercial-amendment foundation

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` and `assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` define a fail-closed server readiness boundary for the first `ADDITIONAL_CHARGE` amendment against an issued Australian tax invoice. The pure contract requires exact source-before and target-after pricing evidence, positive fully taxable standard-GST effect, applied chronology, complete provider-neutral settlement, and zero earlier adjustment notes. The service requires `payment:manage` and reloads all legal/commercial evidence inside tenant + booking scope.

Persistence now carries explicit `adjustmentType` plus mutually exclusive decrease/increase material amounts. Existing cancellation and decreasing commercial rows default to `DECREASING` with zero increase columns. Structurally supported increasing rows require zero decrease columns and a positive exact standard-GST increase.

Schema version 4 defines immutable `INCREASING / COMMERCIAL_AMENDMENT` evidence for source ordinal `1`. It freezes source invoice authority, applied amendment and exact target-pricing ids/fingerprints, before/after tax and total money, and the canonical increase. It cannot carry refund or predecessor authority. PostgreSQL snapshot constraints bind that JSON evidence to the material direction/effect columns and preserve schema versions 1-3 unchanged in meaning.

No schema-version-4 writer, API route, primary action, customer document, accounting/reconciliation projection, HTML, or PDF path exists yet. Current application reads therefore continue to reject increasing evidence rather than presenting database capability as product support. See `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`.

## Decreasing persistence and chain integrity

`HospitalityIssuedAdjustmentNote` persists `predecessorAdjustmentNoteId`, `predecessorSourceAdjustmentOrdinal`, and `sourceAdjustmentOrdinal` for repeated commercial decreases.

PostgreSQL preserves cancellation and first-commercial rows while enforcing same organization, booking, original source invoice, reason, and exact previous ordinal through the predecessor self-reference; `predecessorSourceAdjustmentOrdinal = sourceAdjustmentOrdinal - 1`; no self-predecessor; one successor per predecessor; ordinal `1` rows without predecessor authority; and schema-version-3 commercial rows with ordinal `2+` and predecessor authority.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` independently reloads the source invoice, all decreasing adjustment rows for that source, every applied commercial amendment, and every exact target pricing-evidence row inside caller transaction and tenant/booking scope. It requires row/snapshot/material agreement, canonical document fingerprints, contiguous ordinals, exact predecessor identity, chronology, price continuity and standard-GST decreases. Mixed cancellation/commercial history fails closed. Validation is bounded to 5,000 adjustment documents per source invoice.

For a write, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` first acquires a PostgreSQL transaction advisory lock for the tenant + booking + source invoice and then reloads the verified decreasing chain.

## Reachable decreasing issuance

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` derives the current legal baseline from the verified decreasing chain and requires exactly one unambiguous applied decreasing amendment to match it. It reloads exact target pricing evidence, derives settlement from the complete provider-neutral booking payment ledger, reruns cumulative readiness, and requires readiness ordinal/predecessor identity to equal the verified chain.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` is the reachable decreasing API boundary. The server chooses the first or repeated writer from verified persisted state; the browser cannot supply ordinal, predecessor, GST, amounts, provider truth, pricing fingerprints, sequence, or issue time. Exact retries for already-issued amendment authority remain idempotent after the existing document is re-proven as a member of the verified source chain.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require both `booking:read` and `payment:read`. Staff detail/register/accounting projections and tax-document reconciliation validate schema-version-3 decreasing rows through the complete commercial source chain instead of one-row amendment checks.

Public booking-capability history performs booking-capability ownership authorization first and then verifies the same complete decreasing commercial chain. Customer projections exclude internal predecessor ids/fingerprints, amendment ids, target-evidence ids, provider/payment references, actors, credentials, and secrets.

Authenticated and public deterministic PDF routes reuse those verified read boundaries, so repeated decreasing commercial adjustment notes are renderable under the same current lossless-text/AUD contract once issued. The PDF remains a deterministic read projection and never becomes issuance authority.

## Remaining production boundaries

Increasing adjustment-note issuance/read/delivery and cumulative or mixed-direction increasing semantics, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, and other jurisdictions remain unsupported and must fail closed.

Durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
