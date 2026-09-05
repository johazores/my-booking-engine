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

Repeated decreases use schema version 3 / ordinal `2+`. Each before-price must equal the verified predecessor after-price. Immutable evidence binds predecessor id/ordinal/document number/time/fingerprint and pricing continuity.

### Increasing commercial amendments

Reachable increasing issuance is currently the first increase only. It requires the immutable source tax invoice to equal the amendment before-price, exactly one applied `ADDITIONAL_CHARGE` amendment, exactly one immutable target-pricing record matching the after-price, exact positive standard-GST effect, complete provider-neutral settlement, valid chronology and zero earlier adjustment notes. It uses schema version 4 / ordinal `1`.

Schema version 5 defines a repeated increasing commercial adjustment at ordinal `2+` and freezes predecessor identity, ordinal, document number/time/fingerprint, predecessor after-pricing fingerprint, and exact positive increase effect. PostgreSQL admits that shape with exact predecessor continuity. A serializable server-only writer now emits it from the locked verified chain head, but product orchestration does not import that writer yet.

## Shared commercial legal-chain verification

The bounded tenant-scoped commercial adjustment chain verifier now supports schema versions 2 through 5 and both increasing and decreasing directions. It rejects mixed non-commercial reasons, gaps, forks, duplicate authority, unsupported direction/schema combinations, baseline or target-pricing drift, chronology regressions, issuer/recipient changes, invalid standard-GST effects, and settlement that does not reconcile.

Each row's payment authority is independently re-proved from a progressive provider-neutral ledger: base booking payment truth plus only commercial-amendment transactions belonging to the verified legal chain through that ordinal. This preserves historical settlement proof for earlier documents after later adjustments are added and prevents a future/unissued amendment from changing an earlier legal step's settlement baseline.

The existing write-head selector still serializes one tenant/booking/source-invoice chain with a PostgreSQL transaction advisory lock before returning the verified head.

## Product issuance boundary

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` remain the product-facing boundary. They require `payment:manage`, tenant- and booking-scope source authority, derive direction from persisted amendments, preserve cancellation priority, and reject ambiguous candidates.

The reachable product path still delegates decreasing issuance to the existing verified first/repeated orchestration and first increasing issuance to the schema-version-4 writer. An existing increasing document remains terminal until the repeated-increasing writer and downstream product projections are upgraded coherently.

The API request body remains only `sourceInvoiceDocumentNumber`. The browser never selects legal direction, GST, money, ordinal, predecessor, provider truth, sequence or issue time.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require `booking:read` plus `payment:read` and are tenant-scoped server-side. Public booking-capability history authorizes tenant slug, encrypted capability, persisted booking ownership, unexpired principal and tenant-owned booking before any legal document is returned.

The shared actor-neutral chain read boundary can now prove referenced schema-version-2-through-5 commercial rows. Existing product call sites intentionally remain unchanged in this slice: reachable decreasing rows use the shared chain boundary and first-increasing rows use the existing first-only verifier. Schema-version-5 customer/staff/accounting/PDF projection remains closed until those surfaces are migrated together.

## Remaining production boundaries

The immediate next dependency is authenticated/public read, accounting, reconciliation, HTML/PDF, and product-orchestration integration on the same direction-aware authority. Product reachability for the repeated-increasing writer stays closed until those downstream surfaces are coherent.

Cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST rules, arbitrary staff-entered reasons, generic reissue/void/correction, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
