# Australian adjustment notes

## Purpose

SF has a deliberately narrow Australian decreasing-adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with its own immutable evidence; this is not a generic credit-note button.

The current issued contract remains AU/AUD and fully taxable standard GST.

## Supported issued events

SF supports two first-adjustment issuance authorities:

### Booking cancellation

`BOOKING_CANCELLATION` requires:

- a verified persisted Australian tax invoice for the active tenant + booking;
- booking status `CANCELLED` and payment status `REFUNDED`;
- exactly one attributed successful non-commercial-amendment full refund matching the source invoice currency and total;
- a persisted settlement-source reference; and
- exact standard-GST reconciliation.

The immutable schema-version-1 document keeps the exact `refundTransactionId` as legal authority.

### Commercial amendment

`COMMERCIAL_AMENDMENT` requires:

- the verified source tax invoice to match the amendment frozen before-price and pricing fingerprint exactly;
- one exact applied `REFUND` commercial amendment belonging to the same tenant + booking;
- exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row matching the amendment after-price;
- exact standard GST before and after;
- the complete provider-neutral booking settlement to reconcile to the applied after-total; and
- no prior adjustment note against the source tax invoice.

The immutable schema-version-2 document keeps the exact `commercialAmendmentId` and `targetPricingEvidenceId` as legal authority. It deliberately does not persist one refund transaction because amendment settlement can span multiple payment sources.

## Persistence and database integrity

`HospitalityIssuedAdjustmentNote` carries nullable cancellation/commercial authority columns plus `sourceAdjustmentOrdinal`. PostgreSQL fixes the ordinal to `1` and enforces one `(organizationId, sourceInvoiceId, sourceAdjustmentOrdinal)` record. This preserves the current one-adjustment-per-source contract.

The database independently enforces:

- AU/AUD adjustment-note identity and numbering shape;
- reason-specific authority exclusivity;
- source ordinal `1`;
- tenant + booking composite foreign keys to source invoice and reason-specific authority;
- schema-version-1 cancellation versus schema-version-2 commercial snapshot shape;
- material decrease/fingerprint agreement; and
- commercial before/after standard-GST reconciliation inside the immutable snapshot.

There is currently no predecessor-adjustment relation and no persisted cumulative baseline. Future multiple-adjustment support requires a separate legal/data contract and migration.

## Authorization and issuance

Both issuance paths require `payment:manage`. The browser cannot supply legal seller/buyer identity, ABN, reason, GST, money, sequence, provider truth, fingerprints, or settlement authority.

Commercial-amendment issuance re-runs readiness inside a serializable transaction, binds the exact amendment + target-pricing identities, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates the schema-version-2 snapshot/fingerprint, writes a safe audit event, and is idempotent by commercial-amendment authority. Concurrent first-adjustment issuance remains protected by the tenant/source/ordinal unique contract plus serializable retry handling.

The authenticated tax-invoice page exposes a real commercial-amendment issuance action only when one unambiguous amendment is ready. Existing cancellation issuance retains priority when its supported event is available, avoiding competing legal-document primary actions.

## Authenticated reads, accounting, and reconciliation

Authenticated adjustment-note reads require both `booking:read` and `payment:read` and support both current reasons. The shared read boundary validates:

- persisted row, schema-version-specific snapshot, material columns, and document fingerprint;
- the complete immutable source tax invoice;
- cancellation refund authority for cancellation notes; or
- applied amendment + exact target pricing evidence for commercial-amendment notes.

The authenticated adjustment register and detail page use that shared validated projection. Accounting CSV export also uses it, and tenant tax-document reconciliation validates the complete adjustment-note register rather than cancellation rows only.

Unknown authority, cross-tenant links, stale/malformed evidence, source-invoice drift, or unsupported document reason fail closed.

## Customer document and PDF boundary

The authenticated HTML adjustment-note document supports both current reasons and clearly shows the source tax invoice, reason, before/after amount, and exact GST decrease.

The deterministic server PDF and public booking-capability document projection remain cancellation-only. Commercial adjustment notes therefore do not display a PDF action and are not exposed through public recovery/history yet. Those paths must be expanded with the same reason-specific integrity checks before being enabled.

## Unsupported adjustments

Partial refunds, repeated/multiple adjustments, cumulative predecessor chains, increasing adjustments, mixed taxability, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, and other jurisdictions remain unsupported and must fail closed.

## Legal and operational boundary

Australian Taxation Office guidance treats cancellation or a change in consideration as an adjustment event. SF does not treat this implementation or documentation as legal advice. Durable customer authentication/history, email/resend, commercial-amendment deterministic PDF/public delivery, universal Unicode-safe PDF support, production Node 24/PostgreSQL verification, and jurisdiction/legal review remain separate production work.
