# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, and delivery so no browser action or mutable customer/pricing record can become legal-document authority by accident.

The implemented issuance foundation currently supports only the narrow Australian `TAX_INVOICE` contract documented in `docs/australian-tax-invoice-contract.md`.

## Persistence

`HospitalityInvoicePreparation` freezes the accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and document preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by:

- `organizationId`;
- `jurisdictionCode`; and
- `documentType`.

The first supported tuple is `AU / TAX_INVOICE`. Allocation happens in the same serializable transaction that creates the issued invoice. A failed transaction cannot commit only the sequence increment.

`HospitalityIssuedInvoice` stores the committed immutable document identity and evidence:

- organization, booking, preparation, pricing-evidence, and issuer-profile identity;
- jurisdiction, document type, document number, and numeric sequence;
- issuing actor and issue timestamp;
- exact integer minor-unit money and currency;
- preparation, pricing, issuer, recipient, and document fingerprints; and
- the complete immutable document snapshot used by future renderers.

PostgreSQL composite foreign keys independently prevent cross-tenant or cross-booking references. Unique constraints prevent two issued documents for one preparation and prevent duplicate tenant/jurisdiction numbers or sequence values.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage` before reading tenant-owned issuance data.

A first issuance must pass the shared Australian preparation-verification boundary, which validates the immutable preparation and recipient, issuer, accepted pricing evidence, exact money, and current accepted booking commercial state. The service then derives the sequence, number, issue time, legal snapshots, and document fingerprint server-side.

The caller cannot submit legal/tax money, invoice number, sequence, issuer, recipient, tax lines, or document fingerprint as authority.

A retry first looks for the already-issued `(organizationId, preparationId)` record and validates its immutable snapshot/fingerprint. This preserves idempotency even after later booking changes. A not-yet-issued stale preparation is rejected before sequence allocation.

## Rendering and delivery boundary

`HospitalityIssuedInvoice.documentSnapshot` is the future renderer input. No PDF, email, download route, or customer-facing `Tax invoice` action should be added until it renders from this immutable snapshot and its access/delivery requirements are implemented end to end.

The existing payment receipt remains separate settlement evidence. It must not be transformed into a tax invoice by UI wording alone.

## Corrections

Issued rows are historical evidence and must not be edited to reflect later refunds or commercial amendments. Correction/credit-note/reissue work must create its own immutable linked document lifecycle and numbering rules.
