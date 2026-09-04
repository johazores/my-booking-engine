# Australian commercial-amendment adjustment readiness

## Purpose

SF now has a server-side readiness contract for the first Australian hospitality **commercial-amendment decreasing adjustment**. This is deliberately a prerequisite to legal-document issuance, not a hidden or fake adjustment-note workflow.

The contract answers one production question: after a previously invoiced booking has an applied price-decreasing commercial amendment, does SF have enough immutable evidence to prove one exact Australian decreasing adjustment before a future adjustment-note record is allowed to exist?

No route, button, sequence allocation, PDF, email, accounting row, or persisted adjustment note is created by this readiness service.

## Authority

`assessHospitalityCommercialAmendmentAdjustmentReadiness` requires `payment:manage` and derives organization and actor authority server-side.

Inside one serializable tenant-scoped read, it verifies:

- the source document is the requested organization + booking Australian tax invoice;
- the source invoice snapshot, material columns, document fingerprint, issuer/recipient evidence, pricing evidence, and Australian tax-invoice document contract still reconcile;
- the requested commercial amendment belongs to the same organization + booking;
- exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row belongs to that amendment and its persisted material columns still match the parsed pricing breakdown;
- the complete booking payment ledger reconciles through the existing commercial-amendment settlement domain; and
- no previously issued adjustment note already uses the source invoice under this first-step contract.

The caller does not provide price totals, GST, currency, provider, settlement source, amendment direction, pricing fingerprints, or adjustment money as authority.

## Supported decreasing-adjustment contract

`assessAustralianCommercialAmendmentAdjustmentReadiness` returns ready only when all of these conditions hold:

1. the source invoice is AU/AUD and its immutable price components reconcile;
2. the commercial amendment is `APPLIED`, has direction `REFUND`, and was applied no earlier than the source invoice issue timestamp;
3. the source invoice money and pricing fingerprint exactly match the amendment's frozen **before** price, establishing one legal baseline;
4. the amendment's frozen **after** price exactly matches its immutable target pricing evidence;
5. there is no earlier adjustment note against that source invoice;
6. before and after prices are both fully taxable standard-GST evidence where GST is exactly one-eleventh of the GST-inclusive total;
7. the decrease is positive, the signed amendment delta equals that decrease, and the subtotal/GST/total decrease reconciles exactly; and
8. amendment-owned settlement is fully reconciled, with the exact refund adjustment settled, nothing remaining, and booking net settlement equal to the applied after-total.

This initial contract intentionally supports only the **first** legal adjustment against a source invoice. That avoids inventing cumulative legal-baseline semantics while the current persisted adjustment-note model still represents only the full-cancellation/single-refund lifecycle.

## Why the contract is separate from settlement

Payment settlement proves that money moved. It does not by itself prove the legal tax-document baseline.

A commercial-amendment refund can span multiple settlement sources, and SF already persists those operations with `PaymentTransaction.commercialAmendmentId` and source attribution. Readiness therefore consumes the existing provider-neutral reconciliation result rather than selecting a refund transaction or trusting one provider callback.

The legal decrease is derived from immutable before/after pricing evidence, not from refund rows. This prevents provider transaction shape from becoming tax authority.

## Australian legal reference

ATO guidance treats a change in consideration as an adjustment event. GSTR 2000/19 also gives examples where a changed agreed quantity/consideration creates an adjustment event. GSTR 2013/2 describes the adjustment-note information and decreasing-adjustment framework.

SF keeps this contract narrow and does not treat the implementation as legal advice. Jurisdiction/legal review remains required before commercial-amendment adjustment-note issuance is enabled in production.

## Next persistence dependency

The current `HospitalityIssuedAdjustmentNote` schema requires one `refundTransactionId`, hard-codes `BOOKING_CANCELLATION`, and effectively supports one cancellation note per source invoice. It cannot faithfully persist an amendment-owned refund that may span multiple settlement sources.

The next coherent step is a deliberate adjustment-authority schema evolution that can bind an issued note to the exact commercial amendment without guessing one refund row, preserve existing cancellation documents, define cumulative/multiple-adjustment ordering, and update immutable read/PDF/accounting/reconciliation validators together.

Until that persistence boundary is implemented and validated, commercial-amendment readiness stays internal and no customer/staff issuance action is exposed.
