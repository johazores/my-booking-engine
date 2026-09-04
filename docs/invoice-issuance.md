# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so browser input or mutable booking/customer data never becomes legal-document authority by accident.

The Australian foundation supports tax invoices, full-cancellation decreasing adjustment notes, and first or repeated commercial-amendment decreasing adjustment notes under the current AU/AUD fully taxable standard-GST contract. A first increasing commercial-amendment writer and complete read/delivery authority are also implemented, but increasing issuance remains disconnected from the product action/API pending direction-aware orchestration.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, recipient snapshot/fingerprint, exact money, and preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by organization, jurisdiction, and document type. Allocation occurs inside the same serializable transaction as document creation.

`HospitalityIssuedInvoice` stores immutable tax-invoice identity and evidence.

`HospitalityIssuedAdjustmentNote` is direction-, reason-, and schema-specific:

- schema version 1 / `DECREASING / BOOKING_CANCELLATION`: one exact `refundTransactionId`, no commercial-amendment/target/predecessor authority, ordinal `1`;
- schema version 2 / first `DECREASING / COMMERCIAL_AMENDMENT`: exact `commercialAmendmentId` and immutable `targetPricingEvidenceId`, no synthetic refund id or predecessor, ordinal `1`;
- schema version 3 / repeated `DECREASING / COMMERCIAL_AMENDMENT`: the same amendment/target authority plus exact immediate-predecessor authority, ordinal `2+`; and
- schema version 4 / first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied `ADDITIONAL_CHARGE` amendment and immutable target-pricing authority, zero decrease columns, exact positive increase columns, no refund/predecessor authority, ordinal `1`.

PostgreSQL binds repeated decreasing predecessor rows to the same tenant, booking, original source invoice, adjustment reason, and exact previous ordinal. Unique predecessor authority prevents forks; checks prevent gaps and self-predecessors; and schema-version-3 snapshot/material checks preserve predecessor and pricing-fingerprint continuity. Schema-version-4 checks make the first-increasing direction/material effect mutually exclusive with decrease evidence.

## Tax-invoice and cancellation issuance

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, and derives sequence, number, issue time, legal snapshot, and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` requires `payment:manage`, verifies source invoice, cancellation/refund state, one exact attributed successful full refund, and immutable money. It refuses issuance when another legal adjustment already exists for the source invoice.

## Decreasing commercial-amendment issuance

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` derives the current legal price baseline from the complete verified commercial-adjustment source chain. It requires exactly one unambiguous applied decreasing amendment matching that baseline, one exact immutable target-pricing record, standard-GST reconciliation, valid chronology, and complete provider-neutral settlement. It returns a server-derived next source ordinal only after cumulative readiness passes.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` is the API-facing decreasing orchestration boundary. Exact idempotent retries first prove the existing document belongs to the verified source chain. A new request must name the same amendment as the unique chain-derived candidate; the server then selects the ordinal-1 or repeated writer from the derived source ordinal. The browser never supplies an ordinal or predecessor.

`issueHospitalityCommercialAmendmentAdjustmentNote` writes schema version 2 / ordinal `1` inside its serializable first-adjustment boundary.

`issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` writes schema version 3 / ordinal `2+`. It requires `payment:manage`, rejects non-commercial legal history, acquires the source-chain advisory lock, reloads the exact amendment and immutable target pricing evidence, derives settlement from the provider-neutral payment ledger, and reruns cumulative readiness with the complete verified predecessor set. The readiness result must match the locked chain head on next ordinal and predecessor identity.

Only then does the repeated writer allocate the shared adjustment-note sequence, create schema-version-3 evidence, persist relational predecessor authority, and reload the complete chain. The transaction can commit only when the new row is the verified head and the next expected ordinal advances exactly once. Supported serialization/uniqueness conflicts use the bounded retry policy.

## First-increasing commercial-amendment issuance foundation

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` revalidates one tenant-owned AU/AUD source invoice, one exact applied `ADDITIONAL_CHARGE` amendment, one immutable target-pricing record, positive standard-GST effect, complete provider-neutral settlement, chronology, source-baseline uniqueness and zero existing adjustment notes.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the serializable schema-version-4 writer. It requires `payment:manage`, reloads the legal/commercial authority in the write transaction, derives every money/tax field and issue-time value server-side, allocates the shared adjustment-note sequence, immediately revalidates persisted material/snapshot evidence, remains idempotent by commercial-amendment authority, and records the issuance audit.

The writer is intentionally not imported by the current product route. The next production dependency is server-derived direction-aware availability/orchestration so the existing commercial-amendment action can distinguish the supported first-increasing case from the existing decreasing chain without accepting browser-selected legal direction or money.

The browser never supplies legal reason, GST, amount, currency, provider truth, settlement result, parties, ABN, sequence, issue time, fingerprint, predecessor authority, or adjustment direction.

## Authenticated and customer projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`. Issuance is a separate `payment:manage` operation.

Adjustment detail/register, accounting CSV, tax-document reconciliation, deterministic PDF, and public booking-capability history support cancellation, verified decreasing commercial documents, and verified first-increasing schema-version-4 documents. Decreasing selected rows must belong to the complete verified source chain. Increasing rows must pass `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows`, which independently re-proves tenant/resource scope, source invoice, exact applied amendment, target pricing, full booking payment ledger, sole source-adjustment authority, source-baseline uniqueness, chronology, material effect and fingerprints.

Public booking capability and persisted ownership are checked before customer tax-document history is loaded. Customer-safe outputs exclude predecessor ids, internal fingerprints, actors, provider/payment/refund references, amendment/target-evidence ids, idempotency keys, credentials, and secrets unless a value is legally required on the document itself.

## Remaining production boundary

Direction-aware product orchestration for first-increasing issuance, cumulative/mixed-direction increasing adjustments, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, generic reissue/void/correction, durable re-authenticated customer history, email delivery/resend, universal Unicode-safe PDF rendering, production Node 24/Prisma/PostgreSQL verification, reviewed disposal/de-identification, and jurisdiction/legal review remain separate production work.
