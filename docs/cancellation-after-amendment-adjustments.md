# Cancellation after commercial amendments

## Status

SF now supports a narrow product-reachable terminal Australian booking-cancellation adjustment after an already verified commercial-amendment adjustment chain.

The original tax invoice remains immutable. Commercial changes remain schema-version-2-through-5 adjustment notes. A later full cancellation is a new schema-version-6 `DECREASING / BOOKING_CANCELLATION` document whose legal before-price is the verified current commercial chain-head after-price and whose legal after-price is zero.

The supported contract remains AU/AUD, fully taxable standard GST. Broader mixed-taxability, partial-refund, generic correction, and other-jurisdiction semantics remain outside this contract.

## Refund authority

A cancellation after one or more commercial amendments can require more than one provider-neutral refund transaction because the current legal price may have been settled across more than one payment source.

Schema version 6 therefore freezes an ordered, bounded refund-authority set rather than one caller-selected refund ID. The set contains between 1 and 256 successful refund transaction IDs, ordinals, amounts, and timestamps. Its exact sum must equal the verified current legal price.

Provider-specific APIs are not embedded in the legal-document contract. SF re-derives money authority from the provider-neutral payment ledger.

## Readiness authority

`deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness` accepts only a verified commercial chain head and requires:

- booking state `CANCELLED` and payment state `REFUNDED`;
- booking currency/total still equal to the verified current legal chain-head price;
- AU/AUD standard-GST chain-head pricing;
- provider-neutral settlement at the chain-head issue time equal to the immutable legal price;
- no pending or ambiguous post-head payment activity;
- every successful post-head movement to be a source-attributed non-commercial refund;
- current settlement to reconcile exactly to zero; and
- the ordered post-head refund set to total exactly the current legal price.

The result derives the next source ordinal, immediate predecessor identity, predecessor document number/time/fingerprint, predecessor after-pricing fingerprint, exact decrease subtotal/GST/total, and refund-authority set. None of those values is browser-selected.

`getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability` requires `payment:manage`, tenant + booking + AU source-invoice scope, a serializable read, and the complete commercial-chain verifier. Existing schema-version-6 documents are independently reverified before their link is exposed.

## Immutable schema-version-6 evidence

`createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot` freezes:

- source invoice identity and issue time;
- source adjustment ordinal `2+`;
- immediate predecessor adjustment-note ID, ordinal, document number, issue time, document fingerprint, and after-pricing fingerprint;
- a before-pricing fingerprint equal to the predecessor after-pricing fingerprint;
- exact before GST/total and zero after GST/total;
- the ordered bounded refund-authority set;
- exact standard-GST decrease subtotal/GST/total;
- shared AU adjustment-note sequence/document identity;
- issuer, recipient, and source-invoice fingerprints; and
- the Australian `Booking cancellation` legal label.

The parser recreates the canonical immutable shape and rejects normalization drift or extra mutable evidence before the document fingerprint is accepted.

## Persistence and terminal chain authority

Migration `20260905113000_cancellation-after-amendment-authority` admits schema-version-6 only for `DECREASING / BOOKING_CANCELLATION` at ordinal `2+`, with no legacy single-refund, commercial-amendment, target-pricing, or increasing-effect authority columns.

The predecessor relation permits the terminal cancellation to reference the immediate commercial predecessor while remaining same-tenant, same-booking, same-source, and exactly previous-ordinal. The unique predecessor reference prevents forks.

Historical commercial reads may tolerate exactly one structurally terminal cancellation so earlier commercial documents remain independently verifiable. That tolerance is read-only: the locked commercial write-head selector remains strict, so no later commercial adjustment can be appended after a cancellation.

## Post-issuance read authority

`hospitality-cancellation-after-amendment-adjustment-authority-service.ts` independently verifies every persisted schema-version-6 document before shared projections can expose it. The verifier:

- parses and fingerprints the canonical snapshot;
- reloads the complete tenant-scoped commercial predecessor chain;
- proves exact predecessor ID/ordinal/document number/time/fingerprint and pricing continuity;
- reloads the source tax invoice under tenant + booking scope;
- reloads provider-neutral payment transactions under tenant + booking scope;
- reconstructs payment truth only through the legal document issue time;
- re-runs cancellation readiness against that issue-time ledger; and
- compares every frozen refund ID, ordinal, amount, timestamp, legal amount, and fingerprint to independently derived authority.

`hospitality-issued-adjustment-note-authority-service.ts` dispatches schema-version-6 evidence through that verifier. Staff detail/register/accounting, reconciliation, public capability history, authenticated/public HTML, and deterministic PDF delivery inherit the same verified document boundary.

Customer-safe projections do not expose predecessor IDs, payment/provider references, refund transaction IDs, actors, or fingerprints unless legally required.

## Serializable issuance and product boundary

`issueHospitalityCancellationAfterAmendmentAdjustmentNote` requires `payment:manage` and a tenant/booking/source tax invoice. It selects the complete verified commercial chain head under the existing PostgreSQL transaction advisory lock inside a serializable transaction, re-derives cancellation readiness from the provider-neutral ledger, allocates the shared tenant `AU / ADJUSTMENT_NOTE` sequence, creates canonical schema-version-6 evidence, persists it, immediately re-verifies the created document in the same transaction, and writes an issuance audit.

Retry handling covers serializable and uniqueness races. An idempotent existing schema-version-6 document is returned only after full post-issuance authority verification. Audit metadata records the refund-authority count but not individual refund IDs.

The existing cancellation route remains backward compatible: schema-version-1 issuance receives the legacy server-derived single refund ID, while schema-version-6 issuance is selected when the request contains only the source invoice number. The schema-version-6 writer then derives the refund set, legal money, GST, ordinal, predecessor, numbering, fingerprints, and issue time server-side.

The tax-invoice page evaluates terminal cancellation authority before any new commercial-adjustment action. The UI receives the server-derived chain position for confirmation only. The browser cannot choose refund IDs, legal money, GST, ordinal, predecessor, provider truth, numbering, fingerprint, or issue time.

## Validation boundary

Dependency-free domain/source-contract coverage now includes readiness, immutable snapshot/persistence structure, historical commercial-read tolerance, schema-version-6 post-issuance authority, serializable writer contracts, idempotent verification, product routing, browser-authority exclusion, and downstream shared projection dispatch.

Full repository validation, live migration/drift execution, PostgreSQL constraint/concurrency verification, and production build remain dependent on the repository-required Node 24 dependency checkout and an explicitly disposable PostgreSQL target.

Jurisdiction-specific production use still requires the repository's planned legal review; this engineering contract is not a substitute for legal advice.

## Remaining adjacent work

Phase 12 still has separate work for mixed-taxability and partial/non-standard-GST adjustment semantics, generic correction/void/reissue, durable customer re-authentication and email/resend, universal Unicode-safe deterministic PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review.
