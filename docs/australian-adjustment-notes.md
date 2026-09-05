# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is separately numbered immutable legal evidence; SF does not provide a generic staff-entered credit-note workflow.

Reachable issuance is AU/AUD under the current fully taxable standard-GST contract. It supports full booking-cancellation decreases, first/repeated commercial-amendment decreases, and one first increasing commercial-amendment adjustment.

## Supported reachable events

### Booking cancellation

`DECREASING / BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching source total/currency, settlement-source authority and exact standard-GST reconciliation. Schema version 1 freezes the refund transaction and remains ordinal `1`.

Cancellation cannot be mixed into an existing commercial-amendment chain. Cancellation-after-amendment semantics remain fail closed.

### Decreasing commercial amendments

The first decrease requires the source tax invoice to equal the frozen amendment before-price, one exact applied `REFUND` amendment, exactly one target-pricing evidence record matching the after-price, exact standard GST, complete provider-neutral settlement, valid chronology and no earlier adjustment. It uses schema version 2 / ordinal `1`.

Repeated decreases use schema version 3 / ordinal `2+`. Each before-price must equal the verified predecessor after-price. Immutable evidence binds predecessor id/ordinal/document number/time/fingerprint and pricing continuity. PostgreSQL plus complete server-chain verification prevent gaps, forks, cross-tenant/source links and predecessor drift.

### Increasing commercial amendments

Reachable increasing issuance is currently the first increase only. It requires the immutable source tax invoice to equal the amendment before-price, exactly one applied `ADDITIONAL_CHARGE` amendment, exactly one immutable target-pricing record matching the after-price, exact positive standard-GST effect, complete provider-neutral settlement, valid chronology and zero earlier adjustment notes. It uses schema version 4 / ordinal `1`.

The cumulative readiness foundation now accepts a future ordinal `2+` increase only when a complete verified prior price chain is supplied and the candidate before-price equals the predecessor after-price. The prior price chain may contain supported increases or decreases. Schema version 5 freezes repeated-increasing predecessor identity, prior ordinal, document number/time/fingerprint, after-pricing fingerprint, and exact positive increase effect.

PostgreSQL admits schema version 5 only with commercial-amendment predecessor continuity. No production writer currently emits schema version 5.

## Product issuance boundary

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` remain the product-facing boundary. They require `payment:manage`, tenant- and booking-scope source authority, derive direction from persisted amendments, preserve cancellation priority, and reject ambiguous candidates.

The reachable product path still delegates decreasing issuance to the existing verified first/repeated orchestration and first increasing issuance to the schema-version-4 writer. An existing increasing document remains terminal until the shared verified chain, repeated-increasing writer, read surfaces, accounting/reconciliation, and document delivery all understand the new predecessor authority.

The API request body remains only `sourceInvoiceDocumentNumber`. The browser never selects legal direction, GST, money, ordinal, predecessor, provider truth, sequence or issue time.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require `booking:read` plus `payment:read` and are tenant-scoped server-side. Public booking-capability history authorizes tenant slug, encrypted capability, persisted booking ownership, unexpired principal and tenant-owned booking before any legal document is returned.

Reachable cancellation, decreasing-commercial and first-increasing rows continue through their existing independent verification paths. Schema-version-5 evidence is not reachable, so no customer/staff/accounting/PDF surface can accidentally present it before the read authority is extended.

## Remaining production boundaries

The immediate next dependency is a direction-aware verified commercial adjustment chain and post-issuance authority that can validate schema versions 2 through 5, followed by the repeated-increasing serializable writer and product reachability.

Cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST rules, arbitrary staff-entered reasons, generic reissue/void/correction, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.