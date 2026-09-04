# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is separately numbered immutable legal evidence; SF does not provide a generic staff-entered credit-note workflow.

Reachable issuance is AU/AUD under the current fully taxable standard-GST contract. It supports full booking-cancellation decreases, first/repeated commercial-amendment decreases, and one first-only commercial-amendment increase.

## Supported reachable events

### Booking cancellation

`DECREASING / BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching source total/currency, settlement-source authority and exact standard-GST reconciliation. Schema version 1 freezes the refund transaction and remains ordinal `1`.

Cancellation cannot be mixed into an existing commercial-amendment chain. Cancellation-after-amendment semantics remain fail closed.

### Decreasing commercial amendments

The first decrease requires the source tax invoice to equal the frozen amendment before-price, one exact applied `REFUND` amendment, exactly one target-pricing evidence record matching the after-price, exact standard GST, complete provider-neutral settlement, valid chronology and no earlier adjustment. It uses schema version 2 / ordinal `1`.

Repeated decreases use schema version 3 / ordinal `2+`. Each before-price must equal the verified predecessor after-price. Immutable evidence binds predecessor id/ordinal/document number/time/fingerprint and pricing continuity. PostgreSQL plus complete server-chain verification prevent gaps, forks, cross-tenant/source links and predecessor drift.

### First increasing commercial amendment

The supported increase requires the immutable source tax invoice to equal the amendment before-price, exactly one applied `ADDITIONAL_CHARGE` amendment, exactly one immutable target-pricing record matching the after-price, exact positive standard-GST effect, complete provider-neutral settlement, valid chronology and zero earlier adjustment notes. It uses schema version 4 / ordinal `1`, zero decrease columns and exact positive increase columns.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the serializable idempotent writer and independently revalidates source, amendment, target pricing, settlement, zero prior documents and same-source-baseline ambiguity before number allocation.

## Shared product issuance orchestration

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` from `hospitality-commercial-amendment-adjustment-product-service.ts` are the product-facing commercial-adjustment boundary.

Availability is tenant-scoped, requires `payment:manage`, and derives direction from persisted authority. It preserves the existing verified decreasing chain and only considers first-increasing issuance when no existing legal adjustment chain is present. It rejects ambiguous applied commercial amendments sharing the selected baseline across refund and additional-charge directions.

For a new write, the route amendment id must equal the unique server-derived candidate. `DECREASING` delegates to the existing first/repeated decreasing orchestration; `INCREASING` delegates to the schema-version-4 writer. Exact increasing retries first pass the independent post-issuance verifier. The browser never selects legal direction, GST, money, ordinal, predecessor, provider truth, sequence or issue time.

The API request body remains only `sourceInvoiceDocumentNumber`. The tax-invoice action uses returned direction solely to label and explain the confirmation action.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require `booking:read` plus `payment:read` and are tenant-scoped server-side. Public booking-capability history authorizes tenant slug, encrypted capability, persisted booking ownership, unexpired principal and tenant-owned booking before any legal document is returned.

Cancellation, decreasing-commercial and first-increasing rows are verified independently. Decreasing rows use complete predecessor-chain verification. First-increasing rows use `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows`, which re-proves source invoice, exact amendment, unique target pricing, complete settlement, sole-adjustment authority, material columns, source-baseline uniqueness, chronology and fingerprints.

Register/detail/public UI is direction-aware. Accounting CSV uses explicit direction with separate decrease/increase GST-exclusive, GST and GST-inclusive columns. Reconciliation consumes the verified tenant-scoped register. Authenticated and public PDFs reuse the verified direction-aware document and reject mixed or unreconciled effects.

## Remaining production boundaries

Cumulative increasing adjustments, mixed-direction chains, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST rules, arbitrary staff-entered reasons, generic reissue/void/correction, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
