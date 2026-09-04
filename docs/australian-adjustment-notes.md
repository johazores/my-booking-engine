# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with immutable evidence; SF does not provide a generic staff-entered credit-note workflow.

Reachable product issuance remains AU/AUD, fully taxable standard GST, and decreasing effects. A first increasing commercial-amendment readiness, persistence, and serializable writer foundation now exists, but increasing reads/delivery and product reachability are intentionally still closed.

## Supported reachable events

### Booking cancellation

`BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching the source total/currency, a settlement-source reference, and exact standard-GST reconciliation. Schema version 1 freezes the refund transaction as authority and remains ordinal `1`.

A cancellation adjustment cannot be mixed into an existing commercial-amendment chain. Cancellation-after-amendment semantics remain fail closed.

### Decreasing commercial amendments

The first `COMMERCIAL_AMENDMENT` decrease requires the source tax invoice to equal the amendment frozen before-price, one exact applied `REFUND` amendment, exactly one immutable target-pricing record matching the after-price, exact standard GST, complete provider-neutral settlement, valid chronology, and no earlier legal adjustment. It uses schema version 2 / ordinal `1`.

Repeated decreases use schema version 3 / ordinal `2+`. Each before-price must equal the verified predecessor after-price, and immutable evidence binds the predecessor id/ordinal/document number/time/fingerprint and after-pricing fingerprint. PostgreSQL plus complete server-chain verification prevent gaps, forks, cross-tenant/source links and unverified predecessor drift.

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` are the reachable decreasing route/UI authority. The server derives the current chain baseline and chooses first/repeated issuance; browser input cannot choose legal money, direction, ordinal, predecessor, GST, provider truth, sequence or issue time.

## First-increasing commercial-amendment foundation

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` and `assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` define the first-only `ADDITIONAL_CHARGE` boundary: exact AU/AUD source-before and immutable target-after evidence, positive standard-GST effect, applied chronology, complete provider-neutral settlement, and zero earlier adjustment notes.

Schema version 4 defines immutable `INCREASING / COMMERCIAL_AMENDMENT` evidence for source ordinal `1`, with no refund or predecessor authority. Material persistence uses `adjustmentType = INCREASING`, zero decrease columns, and exact positive increase subtotal/GST/total columns under PostgreSQL checks.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is now the server-only serializable writer. It requires `payment:manage`, reloads all tenant-owned legal/commercial evidence in the authoritative transaction, rejects competing applied amendments that share the same source baseline, allocates the shared `AU / ADJUSTMENT_NOTE` sequence, derives every amount and timestamp server-side, writes schema-version-4 evidence, immediately revalidates the persisted snapshot/material columns, remains idempotent by commercial-amendment authority, and records a tenant-scoped audit.

The writer is intentionally not connected to the current API/UI. Staff/public reads, accounting/reconciliation, HTML and PDF remain decreasing-only and continue to reject unexpected schema-version-4 rows. This prevents issuance of a legal document that the rest of the product cannot safely prove and deliver.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated reachable adjustment-note reads require both `booking:read` and `payment:read`. Public booking-capability history authorizes booking ownership first. Decreasing commercial rows are accepted only after complete source-chain verification; customer projections exclude internal predecessor/amendment/target/provider/payment references and fingerprints.

Authenticated/public deterministic PDF routes reuse those verified decreasing read boundaries. Reconciliation and accounting exports likewise revalidate every included reachable document and fail closed on unsupported evidence.

The next increasing dependency is to extend this shared read authority to schema version 4 and independently re-prove source invoice, amendment, target pricing, settlement and material effect. Accounting/reconciliation and HTML/PDF projection follow; only then should route/UI exposure be enabled.

## Remaining production boundaries

Increasing read/delivery/product reachability, cumulative or mixed-direction increasing semantics, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
