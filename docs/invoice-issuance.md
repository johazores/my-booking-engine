# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so no browser action or mutable customer/pricing record becomes legal-document authority by accident.

The implemented Australian issuance foundation supports tax invoices plus two narrow first decreasing-adjustment reasons: full booking cancellation and one applied price-decreasing commercial amendment.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by `organizationId`, `jurisdictionCode`, and `documentType`. Allocation happens in the same serializable transaction as issued-document creation.

`HospitalityIssuedInvoice` stores immutable tax-invoice identity and evidence.

`HospitalityIssuedAdjustmentNote` is reason-specific:

- schema version 1 / `BOOKING_CANCELLATION`: one exact `refundTransactionId`, no commercial-amendment/target-evidence authority, ordinal `1`;
- schema version 2 / `COMMERCIAL_AMENDMENT`: no refund transaction, exact `commercialAmendmentId`, exact immutable `targetPricingEvidenceId`, ordinal `1`.

PostgreSQL enforces the supported authority shape, source-invoice/ordinal uniqueness, tenant + booking composite foreign keys, snapshot/material-column agreement, and schema-specific AU/AUD adjustment evidence. The current model has no predecessor-adjustment relation and does not support ordinal `2`.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, then derives sequence, number, issue time, legal snapshot, and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` requires `payment:manage`, verifies source invoice, cancellation/refund status, one exact attributed successful full refund, and immutable money. It refuses issuance if any legal adjustment already exists for the source invoice.

`issueHospitalityCommercialAmendmentAdjustmentNote` also requires `payment:manage`. Inside a serializable transaction it revalidates the source invoice, exact applied `REFUND` amendment, exact immutable target pricing evidence, standard-GST before/after values, complete provider-neutral booking settlement, and first-adjustment exclusivity. It then allocates the shared `AU / ADJUSTMENT_NOTE` sequence, creates/fingerprints schema-version-2 evidence, persists amendment/target authority with no synthetic refund id, writes a safe audit event, and is idempotent by tenant + commercial amendment.

The browser supplies only identifiers needed to request the operation. Legal reason, GST, currency, money, provider truth, settlement result, parties, ABN, sequence, issue time, and fingerprints remain server-derived.

## Authenticated read and downstream projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`. Issuance remains a separate `payment:manage` operation.

Authenticated adjustment-note detail/register, accounting CSV, and tax-document reconciliation now validate both supported adjustment reasons. The shared adjustment read boundary revalidates the complete immutable source tax invoice and then the reason-specific refund or amendment/target-pricing authority.

The deterministic adjustment-note PDF and public booking-capability document projection remain cancellation-only. Commercial adjustment notes are not offered through those paths until the same integrity contract is implemented there. Tax-invoice PDF/public behavior and existing cancellation PDF/public behavior remain unchanged.

Customer-safe outputs continue to exclude internal fingerprints, actors, provider/payment/refund references, idempotency keys, credentials, and secrets unless a value is legally required on the document itself.

## Remaining correction boundaries

The current `sourceAdjustmentOrdinal = 1` rule explicitly blocks cumulative/multiple adjustments until SF defines how prior legal adjustments change the baseline for a later note.

Partial refunds, multiple/cumulative adjustments, mixed taxability, generic reissue/void workflows, durable re-authenticated customer history, email delivery/resend, commercial-amendment public/PDF delivery, universal Unicode-safe PDF rendering, full Node 24/PostgreSQL validation, statutory deadline automation, reviewed disposal/de-identification, and legal review remain separate production work.
