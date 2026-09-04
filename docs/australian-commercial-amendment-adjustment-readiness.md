# Australian commercial-amendment adjustment readiness

## Purpose

SF has a server-side readiness contract for the first Australian hospitality **commercial-amendment decreasing adjustment**. This is deliberately a prerequisite to legal-document issuance, not a hidden or fake adjustment-note workflow.

The contract answers one production question: after a previously invoiced booking has an applied price-decreasing commercial amendment, does SF have enough immutable evidence to prove one exact Australian decreasing adjustment before an adjustment note may be issued?

No route, button, sequence allocation, email, accounting row, or issued adjustment note is created by the readiness service.

## Authority

`assessHospitalityCommercialAmendmentAdjustmentReadiness` requires `payment:manage`.

Inside one serializable tenant-scoped read, it verifies:

- the requested organization + booking Australian source tax invoice and all immutable source evidence;
- the requested commercial amendment belongs to the same organization + booking;
- exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record belongs to that amendment and still matches its parsed pricing breakdown;
- the complete booking payment ledger reconciles through the existing provider-neutral commercial-amendment settlement domain; and
- no earlier issued adjustment note already uses the source invoice under the current first-adjustment-only contract.

The caller does not provide price totals, GST, currency, provider, settlement source, amendment direction, pricing fingerprints, or adjustment money as authority.

## Supported decreasing-adjustment contract

Readiness returns ready only when all of these conditions hold:

1. the source invoice is AU/AUD and its immutable price components reconcile;
2. the amendment is `APPLIED`, direction `REFUND`, and was applied no earlier than the source invoice issue timestamp;
3. source invoice money/fingerprint exactly match the amendment frozen **before** price;
4. the amendment frozen **after** price exactly matches its immutable target pricing evidence;
5. no earlier adjustment note exists against that source invoice;
6. before and after prices are fully taxable standard-GST evidence;
7. the positive decrease, signed amendment delta, subtotal, GST, and total reconcile exactly; and
8. amendment-owned settlement is fully reconciled with nothing remaining and net booking settlement equal to the applied after-total.

The current contract intentionally supports only the **first** legal adjustment against a source invoice.

## Provider-neutral settlement versus legal authority

Payment settlement proves money movement. It does not by itself prove the legal tax-document baseline.

A commercial-amendment refund can span multiple settlement sources. SF therefore uses `PaymentTransaction.commercialAmendmentId` and provider-neutral reconciliation rather than selecting one refund transaction.

The legal decrease is derived from immutable before/after pricing evidence, not from a provider callback or refund row.

## Persistence dependency status

The persistence blocker is now resolved.

`HospitalityIssuedAdjustmentNote` can represent either:

- the existing cancellation authority using one exact `refundTransactionId`; or
- a commercial-amendment authority using the exact `commercialAmendmentId` plus exact immutable target pricing-evidence identity, with `refundTransactionId` absent.

The model also carries `sourceAdjustmentOrdinal`. The present contract fixes it at `1` and enforces one `(organization, source invoice, ordinal)` record. This preserves the current single-adjustment behavior while creating an explicit ordering seam for future cumulative semantics.

The schema-version-2 commercial-amendment adjustment-note evidence contract is implemented in `src/server/payments/hospitality-commercial-amendment-adjustment-note-domain.ts`. It freezes the amendment/source chronology, exact before/after standard-GST totals, exact decrease, relevant source/pricing fingerprints, parties, source invoice, and legal labels. It deliberately contains no refund-transaction authority.

PostgreSQL composite foreign keys bind source invoice, target pricing evidence, and commercial amendment to the same booking and tenant. Existing schema-version-1 cancellation notes remain valid and unchanged.

## Why issuance remains closed

Persistence readiness is not customer-facing issuance.

Before SF exposes a commercial-amendment adjustment note, one serializable issuance transaction must:

- re-enter `payment:manage`;
- run/reuse the complete readiness validation at the point of write;
- verify the exact amendment and target-evidence identities persisted into the new authority columns;
- allocate the shared `AU / ADJUSTMENT_NOTE` sequence atomically;
- create the schema-version-2 snapshot and fingerprint;
- make retries idempotent by exact commercial-amendment authority;
- fail closed on source-invoice/pricing/settlement drift or concurrent first-adjustment issuance; and
- write a safe audit event.

Only after that write boundary is complete should the authenticated/public document renderer, deterministic PDF, accounting export, and reconciliation projection be expanded. Existing cancellation projections remain explicitly filtered to `BOOKING_CANCELLATION` so they cannot accidentally interpret a version-2 document using cancellation semantics.

## Australian legal reference

ATO guidance treats a change in consideration as an adjustment event. GSTR 2000/19 includes examples where changed agreed quantity/consideration creates an adjustment event. GSTR 2013/2 describes adjustment-note information and decreasing-adjustment requirements.

SF keeps this contract narrow and does not treat the implementation as legal advice. Jurisdiction/legal review remains required before commercial-amendment adjustment-note issuance is enabled in production.
