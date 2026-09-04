# Australian adjustment notes

## Purpose

SF has a deliberately narrow Australian decreasing-adjustment lifecycle for previously issued hospitality tax invoices.

The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with its own immutable evidence. This is production evidence infrastructure, not a generic credit-note button.

The issued customer workflow remains limited to the AU/AUD, fully taxable standard-GST contract documented in `docs/australian-tax-invoice-contract.md`.

## Supported issued event

The only customer/staff **issuance** workflow currently enabled is `BOOKING_CANCELLATION`.

Cancellation issuance requires all of the following:

- a verified persisted Australian `TAX_INVOICE` for the active tenant and booking;
- booking status `CANCELLED` and payment status `REFUNDED`;
- exactly one successful attributed non-commercial-amendment `REFUND` matching the source invoice currency and full total;
- a persisted settlement-source reference; and
- exact standard-GST reconciliation where the GST decrease is one-eleventh of the total decrease.

Partial refunds, multiple-refund aggregation, mixed taxability, non-AUD documents, and arbitrary staff-entered adjustment reasons still fail closed.

Commercial-amendment **readiness** is separately implemented for the first applied price-decreasing amendment. Issuance for that reason is still closed.

## Reason-specific immutable authority

`HospitalityIssuedAdjustmentNote` now has a reason-specific persistence boundary instead of assuming every legal adjustment is represented by one refund transaction.

For the existing `BOOKING_CANCELLATION` snapshot contract:

- `refundTransactionId` is required;
- `commercialAmendmentId` and `targetPricingEvidenceId` must be absent;
- `sourceAdjustmentOrdinal` is `1`; and
- the existing schema-version-1 snapshot remains unchanged, preserving issued cancellation evidence.

For the prepared `COMMERCIAL_AMENDMENT` persistence contract:

- `refundTransactionId` must be absent, so no arbitrary refund row can become legal authority;
- the exact `commercialAmendmentId` is required;
- the exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence identity is required;
- `sourceAdjustmentOrdinal` is `1`; and
- the schema-version-2 snapshot contract freezes source-invoice identity/chronology, amendment identity/applied time, target pricing evidence, exact before/after standard-GST money, source/before/after pricing fingerprints, parties, legal labels, and the exact decreasing effect.

`src/server/payments/hospitality-commercial-amendment-adjustment-note-domain.ts` defines and validates that schema-version-2 evidence shape. It is a persistence/document contract only; there is still no commercial-amendment issuance route or UI action.

## Database integrity

The migration keeps existing cancellation records intact and makes `refundTransactionId` nullable only under a strict reason/authority check.

PostgreSQL now independently enforces:

- one supported reason-specific authority shape;
- source adjustment ordinal `1` for the current first-adjustment-only contract;
- one `(organization, source invoice, source ordinal)` record;
- one commercial amendment and one target pricing-evidence record per issued adjustment note;
- exact tenant + booking composite foreign keys to the source invoice, cancellation refund, commercial amendment, and target pricing evidence;
- Australian document identity, exact GST money, fingerprint shape, and snapshot/material-column agreement; and
- schema-version-1 cancellation snapshots versus schema-version-2 commercial-amendment snapshots.

The source-invoice and payment tables gain the required `(id, bookingId, organizationId)` uniqueness so the adjustment-note foreign keys cannot cross bookings inside the same tenant.

This is intentionally stricter than relying only on application queries.

## Ordering boundary

The persistence model now carries `sourceAdjustmentOrdinal`, but the current contract permits only ordinal `1`.

That is deliberate. SF does not yet invent a cumulative legal baseline for a second adjustment against the same tax invoice. Future multiple-adjustment support must define how prior adjustment notes change the next legal baseline, then deliberately relax this constraint in a new migration and update document/read/accounting/reconciliation validators together.

## Authorization and tenant isolation

Cancellation issuance still requires `payment:manage`. The browser cannot submit seller identity, ABN, buyer identity, legal reason, currency, GST money, totals, sequence, document number, or fingerprints as authority.

The commercial-amendment readiness service also requires `payment:manage`, scopes the requested tenant + booking + invoice + amendment server-side, validates the immutable target pricing evidence, and reconciles the complete booking payment ledger through the provider-neutral settlement domain.

Authenticated cancellation-document reads, PDFs, the current adjustment register, accounting export, and public recovery projection remain explicitly cancellation-only until the commercial-amendment projection is implemented. They require their existing server-side permissions/ownership and immutable source-document checks.

The cancellation issuance service also blocks issuance when any legal adjustment already exists for the same source invoice, not only when another cancellation row exists.

## Customer document, PDF, accounting, and reconciliation

The existing cancellation customer document and deterministic PDF behavior is unchanged. It shows the adjustment number/date, seller and ABN, frozen buyer, booking-cancellation reason, source tax invoice, before/after cancellation price, and exact decrease excluding GST/GST/total.

`/invoices/adjustments`, the adjustment accounting CSV, and public booking document history currently query `BOOKING_CANCELLATION` records explicitly. They do not mis-render a schema-version-2 commercial amendment through the cancellation document contract.

Tenant reconciliation remains fail-closed if the persisted legal-document register contains a document outside the currently connected validated projection.

## Legal and operational boundary

Australian Taxation Office guidance treats cancellation or a change in consideration as an adjustment event. GSTR 2013/2 remains the adjustment-note legal-validation reference for the current issued cancellation implementation, while GSTR 2000/19 informs the commercial-amendment readiness/evidence boundary.

SF does not treat these contracts as legal advice. Statutory delivery automation, durable customer re-authentication/history, email/resend, universal Unicode-safe PDF support, production Node 24/PostgreSQL verification, and jurisdiction/legal review remain separate production work.

## Remaining expansion

The persistence blocker identified by the readiness work is now resolved: the data model can represent an exact commercial-amendment authority without inventing one refund row, and the first-adjustment ordering boundary is explicit.

Commercial-amendment **issuance is still not enabled**. The next coherent slice must consume the already-verified readiness result inside serializable issuance, create/validate the schema-version-2 immutable snapshot, preserve idempotency/concurrency, and then extend authenticated/public reads, customer document/PDF, accounting export, and reconciliation as one coherent validated projection.

Partial/multiple adjustments, mixed taxability, generic reissue/void/correction workflows, and other jurisdictions still require separate explicit contracts. Existing issued documents must never be rewritten to simulate them.
