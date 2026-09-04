# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with immutable evidence; SF does not provide a generic staff-entered credit-note workflow.

Reachable issuance remains AU/AUD, fully taxable standard GST, and decreasing effects. A first increasing commercial-amendment readiness, persistence, writer and complete read/delivery foundation now exists, but the increasing writer is intentionally not connected to the product API/action yet.

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

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the server-only serializable writer. It requires `payment:manage`, reloads all tenant-owned legal/commercial evidence in the authoritative transaction, rejects competing applied amendments that share the same source baseline, allocates the shared `AU / ADJUSTMENT_NOTE` sequence, derives every amount and timestamp server-side, writes schema-version-4 evidence, immediately revalidates the persisted snapshot/material columns, remains idempotent by commercial-amendment authority, and records a tenant-scoped audit.

The writer is intentionally not connected to the current API/UI. That is now an issuance-orchestration boundary rather than a read/delivery limitation.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require both `booking:read` and `payment:read` and are tenant-scoped server-side. Public booking-capability history authorizes the tenant slug, encrypted booking capability, persisted booking ownership, unexpired public principal and tenant-owned booking before any legal document is returned.

Cancellation, decreasing-commercial and first-increasing-commercial rows are classified separately. Decreasing rows use complete predecessor-chain verification. First-increasing rows use `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows`, which independently re-proves the immutable source invoice, exact applied additional-charge amendment, unique target pricing evidence, complete provider-neutral settlement, sole-adjustment authority, material increase columns, source-baseline uniqueness, chronology and fingerprints. Unsupported or mixed evidence fails closed.

Authenticated register/detail pages and public booking history are direction-aware. They show increase or decrease effects from the verified immutable document projection rather than assuming every adjustment is a credit/decrease. Public projections continue to exclude internal amendment/target/provider/payment/predecessor references and fingerprints.

Accounting CSV export uses an explicit adjustment type plus separate decrease and increase GST-exclusive/GST/GST-inclusive columns. Reconciliation consumes the verified tenant-scoped adjustment register, so first-increasing rows participate in the same integrity scan only after authority verification.

Authenticated and public deterministic PDF routes reuse those verified document projections. PDF validation rejects mixed or unreconciled directional effects and renders direction-correct legal effect labels. The existing deterministic Windows-1252 limitation remains fail closed.

## Remaining production boundaries

The next increasing dependency is product issuance orchestration: server-derived direction-aware availability in the existing commercial-amendment route/action, followed by calling the serializable increasing writer without allowing browser-selected legal direction or amounts.

Cumulative or mixed-direction increasing semantics, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
