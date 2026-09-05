# Cancellation after commercial amendments

## Status

SF now has the server-side readiness, immutable evidence, and PostgreSQL persistence foundation for a terminal Australian booking-cancellation adjustment after an already verified commercial-amendment adjustment chain.

This capability is **not product-reachable yet**. The existing cancellation route and UI continue to issue only the schema-version-1 cancellation document for an unadjusted source tax invoice. No browser action can create schema-version-6 evidence in this foundation slice.

## Legal event model

The original Australian tax invoice remains immutable. Commercial changes continue to be represented by the verified schema-version-2-through-5 adjustment-note chain. If the booking is later fully cancelled, the cancellation is a new terminal decreasing adjustment whose legal before-price is the verified current chain-head after-price, not the original tax-invoice total.

The narrow supported contract remains AU/AUD, fully taxable standard GST. The terminal cancellation reduces that verified current legal price to zero.

## Why cancellation refund authority is plural

After one or more increasing amendments, the current legal price can be settled across more than one provider settlement source. A full cancellation can therefore require more than one refund transaction.

Schema version 6 does not pretend one refund is authoritative. It freezes an ordered, bounded set of successful refund transaction IDs, ordinals, amounts, and timestamps. The set must contain between 1 and 256 transactions and the exact sum must equal the verified current legal price.

The provider-neutral settlement domain remains the authority for money reconciliation. Provider-specific APIs are not embedded in this legal-document contract.

## Readiness authority

`deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness` accepts only a verified commercial chain head and requires all of the following:

- the booking is `CANCELLED` and its payment state is `REFUNDED`;
- the mutable booking currency and total still equal the verified legal chain-head price;
- the chain-head price is AUD and reconciles to exact standard GST;
- provider-neutral settlement at the chain-head issue time equals that immutable legal price;
- payment activity after the chain head contains no pending or ambiguous operation;
- every successful post-head money movement is a source-attributed, non-commercial refund;
- current provider-neutral settlement reconciles exactly to zero; and
- the ordered post-head refund set totals exactly the chain-head legal price.

The result derives the next adjustment ordinal, immediate predecessor identity, predecessor document number/time/fingerprint, predecessor after-pricing fingerprint, exact decrease subtotal/GST/total, and ordered refund authority. None of those values is caller-selected.

`getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability` wraps that domain behind `payment:manage`, tenant + booking + AU source-invoice scope, a serializable transaction, and the complete existing commercial-chain verifier. It refuses an already-issued cancellation and maps damaged chain evidence to a persistence-integrity error.

## Immutable schema-version-6 evidence

`createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot` freezes:

- source invoice identity and issue time;
- source adjustment ordinal `2+`;
- immediate predecessor adjustment-note ID, document number, issue time, document fingerprint, and after-pricing fingerprint;
- the before-pricing fingerprint, which must equal the predecessor after-pricing fingerprint;
- exact before GST/total and zero after GST/total;
- the ordered bounded refund-authority set;
- exact standard-GST decrease subtotal/GST/total;
- AU adjustment-note sequence/document identity;
- immutable issuer/recipient and source-invoice fingerprints; and
- the Australian `Booking cancellation` legal label.

The parser recreates the canonical snapshot and rejects normalization drift or extra mutable shape before the document fingerprint is accepted.

## PostgreSQL authority

Migration `20260905113000_cancellation-after-amendment-authority` admits schema-version-6 only for `DECREASING / BOOKING_CANCELLATION` at ordinal `2+`, with no legacy single-refund, commercial-amendment, target-pricing, or increasing-effect columns.

The existing predecessor relation is changed so the terminal cancellation may reference a commercial predecessor while remaining structurally same-tenant. The predecessor UUID is constrained through the existing `(id, organizationId)` key, and the predecessor ordinal is constrained through the existing `(organizationId, sourceInvoiceId, sourceAdjustmentOrdinal)` key. Server-side issuance must still prove the exact booking/source/head identity through the verified chain before writing.

The existing unique `predecessorAdjustmentNoteId` keeps a chain head from forking. Product/server boundaries remain responsible for terminality: once a cancellation exists, no further commercial adjustment is offered.

## Remaining work before product reachability

The next dependency is the shared post-issuance read authority. Before schema-version-6 issuance is exposed, SF must:

1. teach the shared adjustment-note authority/document projection to parse and independently verify schema-version-6 evidence;
2. make commercial historical verification tolerate exactly one terminal cancellation without treating it as a commercial chain member;
3. re-load every frozen refund transaction tenant-side and verify status, source attribution, chronology, provider-neutral settlement, uniqueness, and exact total;
4. add the serializable writer with the source-chain advisory lock, shared tenant adjustment-note sequence, canonical persistence verification, retry/idempotency behavior, and issuance audit;
5. carry the verified document through authenticated/public reads, accounting, reconciliation, HTML, and deterministic PDF delivery; and
6. only then expose direction-aware availability and issuance in the existing invoice UI/API without allowing the browser to choose refund IDs, money, ordinal, predecessor, fingerprints, numbering, or issue time.

Until those boundaries are complete and validated together, cancellation-after-amendment remains fail closed in the product.

## Validation boundary

Dependency-free domain and source-contract tests cover current readiness and persistence assumptions. Live PostgreSQL migration/constraint/concurrency verification and full repository validation still require the repository Node 24 runtime, installed dependencies, and an explicitly disposable PostgreSQL target.

Jurisdiction-specific production use still requires the repository's planned legal review; this engineering contract is not a substitute for legal advice.
