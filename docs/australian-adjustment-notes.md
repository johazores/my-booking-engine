# Australian adjustment notes

## Purpose

SF now has a deliberately narrow first Australian decreasing-adjustment workflow for a previously issued hospitality tax invoice when the booking is later cancelled and fully refunded.

This is production evidence infrastructure, not a generic credit-note button. The original tax invoice remains immutable and the adjustment note is a separate numbered legal-document record linked to the exact source invoice and refund transaction.

The current contract is intentionally limited to the same AU/AUD, fully taxable standard-GST shape supported by `docs/australian-tax-invoice-contract.md`.

## Supported event

The only supported adjustment reason is `BOOKING_CANCELLATION`.

Issuance is available only when all of the following are true:

- the source document is a verified persisted Australian `TAX_INVOICE` for the active tenant and booking;
- the booking is `CANCELLED` and its payment status is `REFUNDED`;
- exactly one successful, attributed, non-commercial-amendment `REFUND` transaction matches the source invoice currency and full total;
- the refund has a persisted settlement-source reference rather than ambiguous legacy attribution; and
- the full GST-inclusive decrease can preserve the current exact standard-GST evidence contract, where the GST decrease is exactly one-eleventh of the total decrease.

Partial refunds, multiple-refund aggregation, commercial-amendment settlement/compensation refunds, GST-free or input-taxed supplies, mixed taxability, non-AUD documents, and arbitrary staff-entered adjustment reasons fail closed.

## Immutable authority

`HospitalityIssuedAdjustmentNote` stores:

- tenant and booking identity;
- the source issued tax-invoice identity and immutable fingerprint;
- the exact successful refund-transaction identity;
- separate `AU / ADJUSTMENT_NOTE` sequence identity and `AU-ADJ-########` document number;
- issuing actor and timestamp;
- exact decrease before GST, GST decrease, and total decrease;
- frozen issuer and recipient evidence fingerprints;
- a complete immutable document snapshot and SHA-256 document fingerprint.

PostgreSQL constraints independently enforce the Australian document type/number/currency/reason contract, exact money reconciliation, fingerprint shape, JSON snapshot/material-column agreement, and tenant-safe composite foreign keys back to the booking, source invoice, and refund transaction.

The sequence is allocated in the same serializable transaction as issuance. A retry by the same refund transaction returns the already-issued record after integrity validation rather than allocating a second number.

## Authorization and tenant isolation

Issuance requires `payment:manage` server-side. The browser supplies only the source tax-invoice number and selected refund-transaction identifier; it cannot supply seller identity, ABN, buyer identity, reason, currency, tax money, totals, sequence, document number, or fingerprints as authority.

Authenticated document reads require both `booking:read` and `payment:read`, then revalidate the active organization, immutable adjustment snapshot, material columns, document fingerprint, and linked source tax invoice.

The existing public booking capability can also read the customer-safe adjustment document during its valid recovery window. The capability remains out of URLs, ownership/principal/tenant scope is rechecked, and source-invoice linkage is revalidated. Public output does not expose refund IDs, provider references, actors, internal fingerprints, idempotency keys, or credentials.

## Customer document

The rendered document identifies itself as `Adjustment note` and shows:

- adjustment-note number and issue date;
- seller legal identity and ABN;
- frozen buyer identity;
- decreasing-adjustment type and booking-cancellation reason;
- original tax-invoice number and date; and
- decrease excluding GST, GST decrease, and total decrease including GST.

Authenticated and capability-owned public views support browser Print/Save. A deterministic SF-generated PDF for adjustment notes is not implemented yet and must not be implied by UI wording.

## Legal and operational boundary

Australian Taxation Office guidance treats cancellation or a change in consideration as an adjustment event and sets requirements for adjustment-note content and timing. GSTR 2013/2 is the legal-validation reference for the current implementation.

SF does **not** yet automate the statutory delivery deadline, email/resend, durable re-authenticated customer document history beyond the existing public recovery capability, or legal review/approval. Operators must not treat the current implementation as a substitute for jurisdiction-specific tax/legal advice.

## Remaining expansion

Future work must use separate explicit contracts for partial refunds, price corrections, commercial-amendment adjustments, multiple source/refund relationships, broader taxability, deterministic adjustment-note PDFs, durable delivery, retention/accounting export treatment, and any other jurisdiction. Existing issued tax invoices and adjustment notes must never be rewritten to simulate those future workflows.
