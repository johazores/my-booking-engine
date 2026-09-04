# Australian commercial-amendment adjustment readiness

## Purpose

SF has a server-side readiness, issuance, read, PDF, and public-delivery contract for the first Australian hospitality **commercial-amendment decreasing adjustment**. The contract remains intentionally narrow so legal-document behavior cannot outrun the immutable evidence model.

The readiness layer answers whether a previously invoiced booking has enough immutable evidence to support one exact decreasing adjustment. The issuance layer re-runs that evidence inside the serializable write that creates the adjustment note.

## Authority

Readiness and issuance require `payment:manage`.

Inside tenant- and booking-scoped transactions SF verifies:

- the requested AU/AUD source tax invoice and its complete immutable document evidence;
- the exact applied commercial amendment belongs to the same organization + booking;
- exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record belongs to that amendment and its persisted material values still match its parsed pricing breakdown;
- source invoice money and pricing fingerprint exactly match the amendment frozen **before** price;
- amendment frozen **after** price exactly matches the target pricing evidence;
- the complete booking payment ledger reconciles through the existing provider-neutral commercial-amendment settlement domain; and
- no earlier adjustment note already uses the source invoice under the current first-adjustment-only contract.

The caller never supplies price totals, GST, currency, provider, settlement source, amendment direction, pricing fingerprints, or adjustment money as authority.

## Supported decreasing-adjustment contract

Readiness succeeds only when all of these conditions hold:

1. the source invoice is AU/AUD and its immutable price components reconcile;
2. the amendment is `APPLIED`, direction `REFUND`, and was applied no earlier than the source invoice issue timestamp;
3. source invoice money/fingerprint exactly match the amendment frozen before price;
4. the amendment frozen after price exactly matches its immutable target pricing evidence;
5. no earlier adjustment note exists against that source invoice;
6. before and after prices are fully taxable standard-GST evidence;
7. the positive decrease, signed amendment delta, subtotal, GST, and total reconcile exactly; and
8. amendment-owned settlement is fully reconciled with nothing remaining and net booking settlement equal to the applied after-total.

Issuance also refuses an applied timestamp in the future relative to the legal document issue time.

The current contract intentionally supports only the **first** legal adjustment against a source invoice.

## Provider-neutral settlement versus legal authority

Payment settlement proves money movement. It does not by itself prove the legal tax-document baseline.

A commercial-amendment refund can span multiple settlement sources. SF therefore uses `PaymentTransaction.commercialAmendmentId` and provider-neutral reconciliation rather than selecting one refund transaction. The persisted legal authority is the applied commercial amendment plus its immutable target pricing evidence; no synthetic refund row is written into the adjustment-note authority.

## Persistence contract

`HospitalityIssuedAdjustmentNote` can represent either:

- cancellation authority using one exact `refundTransactionId`; or
- commercial-amendment authority using the exact `commercialAmendmentId` plus exact `targetPricingEvidenceId`, with `refundTransactionId` absent.

`sourceAdjustmentOrdinal` is currently fixed to `1`, and PostgreSQL enforces one `(organization, source invoice, ordinal)` row. There is no predecessor-adjustment relation yet. Before/after commercial totals and pricing fingerprints are frozen in the schema-version-2 document snapshot rather than duplicated as separate material columns.

The schema-version-2 commercial-amendment snapshot freezes amendment/source chronology, exact before/after standard-GST totals, exact decrease, source/pricing fingerprints, parties, source invoice identity, and legal labels. Existing schema-version-1 cancellation notes remain unchanged.

## Issuance workflow

`issueHospitalityCommercialAmendmentAdjustmentNote` runs in a serializable transaction and:

- re-enters `payment:manage`;
- re-runs the complete readiness evidence at the write boundary;
- verifies the requested amendment and exact target-pricing identity inside the active tenant + booking;
- allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically;
- creates and fingerprints the schema-version-2 immutable snapshot;
- persists commercial-amendment and target-pricing authority without a refund transaction id;
- is idempotent by tenant + commercial amendment and fails closed if that authority is already bound elsewhere;
- relies on the source-invoice ordinal uniqueness plus serializable retry handling for concurrent first-adjustment issuance; and
- writes a safe audit event without provider secrets or customer payment credentials.

The authenticated tax-invoice page exposes the commercial issuance action only to payment managers and only when readiness reports one unambiguous eligible amendment. Existing cancellation issuance retains priority when a supported cancellation adjustment is available, so the page does not present competing primary legal-document actions.

## Read and downstream status

Authenticated adjustment-note detail and register reads support both cancellation and commercial-amendment documents. The shared read boundary revalidates the immutable source invoice and the reason-specific authority server-side. Accounting CSV export and tax-document reconciliation use the same generic validated register, so commercial documents cannot bypass integrity checking.

The deterministic adjustment-note PDF now supports the commercial document projection and enforces an exact `before > after` and `before - after = decrease` price effect. Authenticated detail pages therefore expose the same real **Download PDF** action for both current reasons.

Public booking-capability document history and PDF delivery also support commercial adjustment notes. The public service first verifies the tenant slug, encrypted booking capability, persisted booking ownership, unexpired matching public principal, and tenant-owned booking, then fully revalidates the source tax invoice and applied amendment + target-pricing authority before returning customer-safe document data. The public PDF route continues to keep the booking capability out of URLs through same-origin POST.

## Remaining boundary

This implementation does not define partial, repeated, cumulative, increasing, mixed-taxability, or predecessor-chain adjustments. It also does not complete durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/PostgreSQL validation, or jurisdiction/legal review.

ATO guidance treats a change in consideration as an adjustment event. SF keeps this implementation narrow and does not treat the code or this document as legal advice; jurisdiction/legal review remains required before commercial-amendment adjustment-note issuance is enabled in production operations.
