# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so browser input or mutable booking/customer data never becomes legal-document authority by accident.

The Australian foundation supports tax invoices, full-cancellation decreasing adjustment notes, and first commercial-amendment decreasing adjustment notes. A protected internal ordinal-`2+` commercial-amendment write boundary now also exists, but repeated issuance is intentionally not exposed until downstream readers and delivery paths are chain-aware.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, recipient snapshot/fingerprint, exact money, and preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by organization, jurisdiction, and document type. Allocation occurs inside the same serializable transaction as document creation.

`HospitalityIssuedInvoice` stores immutable tax-invoice identity and evidence.

`HospitalityIssuedAdjustmentNote` is reason- and schema-specific:

- schema version 1 / `BOOKING_CANCELLATION`: one exact `refundTransactionId`, no commercial-amendment/target/predecessor authority, ordinal `1`;
- schema version 2 / first `COMMERCIAL_AMENDMENT`: exact `commercialAmendmentId` and immutable `targetPricingEvidenceId`, no synthetic refund id or predecessor, ordinal `1`; and
- schema version 3 / repeated `COMMERCIAL_AMENDMENT`: the same amendment/target authority plus exact immediate-predecessor authority, ordinal `2+`.

PostgreSQL binds repeated predecessor rows to the same tenant, booking, original source invoice, adjustment reason, and exact previous ordinal. Unique predecessor authority prevents forks; checks prevent gaps and self-predecessors; and schema-version-3 snapshot/material checks preserve predecessor and pricing-fingerprint continuity.

## Tax-invoice and ordinal-1 issuance

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, and derives sequence, number, issue time, legal snapshot, and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` requires `payment:manage`, verifies source invoice, cancellation/refund state, one exact attributed successful full refund, and immutable money. It refuses issuance when another legal adjustment already exists for the source invoice.

`issueHospitalityCommercialAmendmentAdjustmentNote` requires `payment:manage` and remains first-adjustment-only. In a serializable transaction it verifies the source invoice, one exact applied `REFUND` amendment, immutable target pricing evidence, standard-GST before/after values, complete provider-neutral settlement, and first-adjustment exclusivity before allocating the shared `AU / ADJUSTMENT_NOTE` sequence and persisting schema-version-2 evidence.

## Repeated commercial-amendment write boundary

`issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` is the internal ordinal-`2+` production write service. It is not wired to the current API/UI.

The service requires `payment:manage`, scopes all reads by tenant + booking, rejects non-commercial legal history, and acquires the source-chain advisory lock through `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` inside a serializable transaction.

It then reloads the exact amendment and immutable target pricing evidence, derives settlement from the provider-neutral payment ledger, and reruns cumulative Australian readiness with the complete verified predecessor set. The readiness result must match the locked chain head on next ordinal, predecessor id, predecessor document number, and predecessor document fingerprint.

Only then does the service allocate the shared adjustment-note sequence, create schema-version-3 evidence with the exact predecessor document/fingerprint/after-price authority, and persist both immutable snapshot and relational predecessor columns. The complete chain is reloaded before commit; the new row must be the verified head and advance the next expected ordinal exactly once. Idempotency remains commercial-amendment based and supported serialization/uniqueness conflicts use the bounded retry policy.

The browser never supplies legal reason, GST, amount, currency, provider truth, settlement result, parties, ABN, sequence, issue time, fingerprint, or predecessor authority.

## Authenticated and customer projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`. Issuance is a separate `payment:manage` operation.

Current adjustment detail/register, accounting CSV, tax-document reconciliation, deterministic PDF, and public booking-capability history independently validate the two reachable ordinal-1 reasons. They still reject schema-version-3 rows.

The existing commercial-amendment API route and tax-invoice page continue to use `issueHospitalityCommercialAmendmentAdjustmentNote`, so the new repeated writer cannot create documents through normal product surfaces before downstream support is ready.

## Next dependency

Staff/public adjustment readers, accounting/reconciliation, HTML, and PDF must move to the complete verified-chain boundary. After that validation is in place, availability plus the existing API/UI can safely expose repeated issuance.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, generic reissue/void/correction, durable re-authenticated customer history, email delivery/resend, universal Unicode-safe PDF rendering, production Node 24/PostgreSQL verification, reviewed disposal/de-identification, and jurisdiction/legal review remain separate production work.
