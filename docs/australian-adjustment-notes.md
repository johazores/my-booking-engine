# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian decreasing-adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with its own immutable evidence; SF does not provide a generic staff-entered credit-note workflow.

The supported contract remains AU/AUD and fully taxable standard GST.

## Reachable issued events

### Booking cancellation

`BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching the source invoice total/currency, a persisted settlement-source reference, and exact standard-GST reconciliation. The schema-version-1 document freezes the `refundTransactionId` as legal authority and remains ordinal `1`.

### First commercial amendment

The reachable `COMMERCIAL_AMENDMENT` path requires the source tax invoice to equal the amendment frozen before-price, one exact applied `REFUND` amendment, exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row matching the after-price, exact standard GST, complete provider-neutral settlement at the after-total, valid chronology, and no earlier legal adjustment against the source invoice.

The schema-version-2 document freezes `commercialAmendmentId` and `targetPricingEvidenceId`, deliberately without one synthetic refund transaction. It remains ordinal `1`.

## Repeated commercial-amendment contract

The cumulative readiness domain supports a second or later decreasing commercial amendment only from a complete verified predecessor chain. The chain must be linear, contiguous, chronologically ordered, unique by adjustment/document identity, fully taxable at standard GST, and price-continuous from the immutable source invoice through every predecessor to the new amendment before-price.

Schema version 3 is used for ordinal `2+` commercial documents. It freezes the immediate predecessor adjustment-note id, document number, issue time, document fingerprint, and predecessor after-pricing fingerprint. That after-pricing fingerprint must equal the new amendment before-pricing fingerprint.

## Persistence and database integrity

`HospitalityIssuedAdjustmentNote` persists `predecessorAdjustmentNoteId`, `predecessorSourceAdjustmentOrdinal`, and `sourceAdjustmentOrdinal` for the repeated chain.

PostgreSQL preserves existing schema-version-1 cancellation and schema-version-2 first-commercial rows while enforcing:

- same organization, booking, original source invoice, reason, and exact previous ordinal through the predecessor self-reference;
- `predecessorSourceAdjustmentOrdinal = sourceAdjustmentOrdinal - 1`;
- no self-predecessor;
- one successor per predecessor, preventing forks;
- ordinal `1` rows have no predecessor authority; and
- schema-version-3 commercial rows require ordinal `2+` and predecessor authority.

## Complete chain verification

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` independently reloads the source invoice, all adjustment rows for that source, every applied commercial amendment, and every exact target pricing-evidence row inside the caller transaction and tenant/booking scope.

The chain validator requires row/snapshot/material agreement, canonical document fingerprints, contiguous ordinals, exact predecessor identity and frozen predecessor document evidence, source/predecessor-to-amendment price continuity, target-pricing agreement, valid chronology, party-fingerprint continuity, and exact standard-GST decrease reconciliation. Mixed cancellation/commercial history fails closed. Validation is bounded to 5,000 adjustment documents per source invoice.

For a write, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` first acquires a PostgreSQL transaction advisory lock for the tenant + booking + source invoice and then reloads the verified chain.

## Internal repeated write boundary

`issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` now implements the ordinal-`2+` persistence path behind that lock. It requires `payment:manage`, runs serializably, and refuses to operate without a verified predecessor.

It reloads the tenant-owned source invoice, exact amendment, exact target pricing evidence, and complete booking payment ledger; derives provider-neutral settlement; reruns cumulative readiness with the complete verified predecessor set; and requires the readiness predecessor identity/ordinal to equal the locked chain head.

The service then allocates the shared `AU / ADJUSTMENT_NOTE` sequence, creates schema-version-3 evidence, persists both immutable snapshot predecessor fields and relational predecessor columns, and reloads the complete chain. The transaction can commit only when the newly created adjustment is the verified head. Idempotency remains tied to commercial-amendment authority, and supported serialization/uniqueness conflicts are retried within the existing bounded policy.

## Reachability and read safety

The existing authenticated tax-invoice action and commercial-amendment adjustment API still use the first-adjustment service. There is no repeated-adjustment primary action and no reachable ordinal-`2+` route yet.

Authenticated adjustment-note reads require both `booking:read` and `payment:read`. The current staff register/detail/accounting/reconciliation path, public booking-capability history, HTML projection, and deterministic PDF projection still support ordinal-1 documents only and fail closed on schema version 3.

This intentional separation prevents the internal write boundary from becoming customer-visible before every read/delivery surface verifies the complete predecessor chain.

## Next production dependency

The next slice is downstream chain-aware read support: staff detail/register, accounting export, tax-document reconciliation, public capability history, HTML, and PDF. Once those surfaces can independently verify schema-version-3 rows, availability and the existing API/UI may switch to the repeated issuance service.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, and other jurisdictions remain unsupported and must fail closed.

Durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, full Node 24/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
