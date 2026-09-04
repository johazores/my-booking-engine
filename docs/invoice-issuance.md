# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so no browser action or mutable customer/pricing record becomes legal-document authority by accident.

The implemented Australian issuance foundation supports tax invoices plus two narrow source-ordinal-1 decreasing-adjustment reasons: full booking cancellation and one applied price-decreasing commercial amendment. Persistence now also reserves a strict predecessor-chain shape for future repeated commercial amendments without making repeated issuance reachable.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by `organizationId`, `jurisdictionCode`, and `documentType`. Allocation happens in the same serializable transaction as issued-document creation.

`HospitalityIssuedInvoice` stores immutable tax-invoice identity and evidence.

`HospitalityIssuedAdjustmentNote` is reason- and schema-specific:

- schema version 1 / `BOOKING_CANCELLATION`: one exact `refundTransactionId`, no commercial-amendment/target/predecessor authority, ordinal `1`;
- schema version 2 / first `COMMERCIAL_AMENDMENT`: no refund transaction, exact `commercialAmendmentId`, exact immutable `targetPricingEvidenceId`, no predecessor authority, ordinal `1`; and
- schema version 3 / future repeated `COMMERCIAL_AMENDMENT`: same amendment/target authority plus exact immediate-predecessor identity, ordinal `2+`.

PostgreSQL preserves the current v1/v2 rows and now adds a structural repeated-chain contract. The composite predecessor self-FK requires the same tenant, booking, original source invoice, adjustment reason, and exact previous ordinal. Unique predecessor authority prevents forks, ordinal checks prevent gaps/self-predecessors, and schema-version-3 JSON/material checks bind the row to persisted predecessor identity and immutable pricing-fingerprint continuity.

This persistence shape does **not** enable repeated issuance. Current service/read paths still reject ordinal `2+` until they independently revalidate the complete predecessor legal-document chain.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, then derives sequence, number, issue time, legal snapshot, and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` requires `payment:manage`, verifies source invoice, cancellation/refund status, one exact attributed successful full refund, and immutable money. It refuses issuance if any legal adjustment already exists for the source invoice.

`issueHospitalityCommercialAmendmentAdjustmentNote` also requires `payment:manage`. Inside a serializable transaction it currently revalidates the source invoice, exact applied `REFUND` amendment, exact immutable target pricing evidence, standard-GST before/after values, complete provider-neutral booking settlement, and first-adjustment exclusivity. It then allocates the shared `AU / ADJUSTMENT_NOTE` sequence, creates/fingerprints schema-version-2 evidence, persists amendment/target authority with no synthetic refund id, writes a safe audit event, and is idempotent by tenant + commercial amendment.

The cumulative readiness domain can already assess a verified predecessor chain and returns the expected next ordinal/chain head. The issuance service does not yet load that chain, so its current behavior remains first-adjustment-only even after the database migration.

The browser supplies only identifiers needed to request a supported operation. Legal reason, GST, currency, money, provider truth, settlement result, parties, ABN, sequence, issue time, fingerprints, and predecessor authority remain server-derived.

## Authenticated and customer projections

Authenticated staff tax-document reads require `booking:read` plus `payment:read`. Issuance remains a separate `payment:manage` operation.

Authenticated adjustment-note detail/register, accounting CSV, tax-document reconciliation, and deterministic PDF projection validate both currently issued ordinal-1 adjustment reasons. The shared adjustment read boundary revalidates the complete immutable source tax invoice and then the reason-specific refund or amendment/target-pricing authority before a PDF is generated.

Public booking-capability history and PDF delivery also support both current ordinal-1 reasons. Public access derives the active tenant from the organization slug, verifies the encrypted booking capability, persisted booking ownership, unexpired matching public principal, and tenant-owned booking, then revalidates the adjustment row, complete source tax invoice, and reason-specific authority before returning customer-safe data.

Persisted schema-version-3/ordinal-2+ documents remain intentionally unsupported by current readers, accounting/reconciliation, HTML, PDF, and public delivery until full predecessor-chain validation is added. Customer-safe outputs continue to exclude internal fingerprints, actors, provider/payment/refund references, idempotency keys, credentials, and secrets unless a value is legally required on the document itself.

## Remaining correction boundaries

The database can now represent a linear repeated commercial-amendment chain, but repeated issuance remains blocked until serializable chain-head selection and full predecessor evidence revalidation are connected through issuance, read, accounting/reconciliation, HTML/PDF, and public delivery.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, generic reissue/void workflows, durable re-authenticated customer history, email delivery/resend, universal Unicode-safe PDF rendering, full Node 24/PostgreSQL validation, statutory deadline automation, reviewed disposal/de-identification, and legal review remain separate production work.
