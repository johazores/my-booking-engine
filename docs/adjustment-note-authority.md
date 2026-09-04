# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The reachable product supports full booking-cancellation adjustment notes and one or more strictly decreasing commercial-amendment adjustment notes for the same original Australian tax invoice, subject to the narrow AU/AUD standard-GST contract below.

## Current issued authority model

`HospitalityIssuedAdjustmentNote` supports reachable issuance for:

- `BOOKING_CANCELLATION`, authorized by one attributed successful full-booking refund transaction; and
- decreasing `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its immutable `COMMERCIAL_AMENDMENT_TARGET` pricing evidence. Commercial settlement can span payment sources, so SF does not invent one synthetic refund transaction as legal authority.

Cancellation documents remain schema version 1 / ordinal `1`. First decreasing commercial-amendment documents use schema version 2 / ordinal `1`. Repeated decreasing commercial-amendment documents use schema version 3 / ordinal `2+` and bind the immediate predecessor document.

A schema-version-4 immutable evidence and database shape now exists for a first increasing commercial amendment, but no production writer/read/API/UI exposes that authority yet.

## Cumulative predecessor-chain contract

A repeated decreasing commercial adjustment is valid only when the complete predecessor set is verified. Ordinals must be contiguous from `1`, identities and fingerprints must be unique, chronology cannot regress, every decrease must remain exact AUD standard GST, the first adjustment must begin at the immutable source-invoice price, and each later amendment before-price must equal the preceding adjustment after-price.

Schema version 3 freezes the immediate predecessor adjustment-note id and ordinal, predecessor document number and issue time, predecessor document fingerprint, and predecessor after-pricing fingerprint. That predecessor after-pricing fingerprint must equal the new document before-pricing fingerprint.

`HospitalityIssuedAdjustmentNote` persists `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal`. PostgreSQL independently enforces same-tenant, same-booking, same-source-invoice and same-reason predecessor scope, the exact previous ordinal, no self-predecessor, and one-successor/no-fork semantics.

## Server chain verification

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the exact AU source tax invoice, the complete persisted decreasing commercial adjustment chain, every referenced applied commercial amendment, and every immutable target pricing-evidence row inside tenant + booking + source-invoice scope. It reparses canonical snapshots, recomputes document fingerprints, revalidates target pricing breakdowns, and verifies all material money/fingerprint links.

The pure chain validator checks source identity, party fingerprints, contiguous ordinals, predecessor row and snapshot identity, frozen predecessor document number/time/fingerprint, amendment chronology, source/predecessor-to-amendment price continuity, target-pricing authority, and standard-GST decreases. Mixed cancellation/commercial chains fail closed. The source chain is bounded to 5,000 documents.

For a write, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` acquires a PostgreSQL transaction advisory lock for the tenant + booking + source invoice before reloading the verified head. Database uniqueness remains the independent fork/ordinal backstop.

## Issuance and product reachability

`issueHospitalityCommercialAmendmentAdjustmentNote` remains the schema-version-2 ordinal-1 decreasing writer. `issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` is the schema-version-3 ordinal-2+ decreasing writer. Both require `payment:manage`, run inside serializable write boundaries, derive legal money and settlement from persisted tenant-owned evidence, allocate the shared `AU / ADJUSTMENT_NOTE` sequence server-side, and remain idempotent by commercial-amendment authority.

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` is the reachable chain-aware decreasing boundary. It independently verifies the complete source chain, derives the current legal price baseline, requires exactly one applied decreasing amendment to match that baseline, revalidates its immutable target pricing evidence and the complete provider-neutral payment ledger, and reruns cumulative Australian readiness. The browser cannot select an ordinal or predecessor.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` is the reachable API orchestration boundary. It preserves exact idempotent retries for already-issued amendment authority, otherwise requires the requested amendment id to equal the unique chain-derived next candidate and then selects the ordinal-1 or repeated decreasing writer server-side. A concurrent chain change is still revalidated by the authoritative writer and fails closed rather than issuing against a stale predecessor.

The authenticated tax-invoice page uses the same chain-aware availability and existing confirmation action. For repeated issuance it shows the next source ordinal and keeps the latest existing adjustment note navigable while the new legal document is being considered.

## Read, accounting, reconciliation, and delivery safety

Authenticated adjustment-note detail/register/accounting/reconciliation reads require both `booking:read` and `payment:read`; issuance requires `payment:manage`. Public booking-capability reads enforce their independent customer authorization boundary before legal-document history is loaded.

All staff and public decreasing commercial-adjustment projections accept schema version 2 and schema version 3 only after the selected rows are proven members of the complete verified source chain. Accounting export, tax-document reconciliation, authenticated/public HTML history, and deterministic PDF delivery therefore reuse the same predecessor-chain authority rather than trusting one row in isolation.

Customer-safe projections intentionally exclude predecessor ids, internal fingerprints, commercial-amendment ids, target-pricing-evidence ids, provider/payment references, actors, credentials, and secrets unless a value is legally required on the document itself.

## Increasing adjustment foundation

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` is a server-only readiness boundary for the first AU/AUD fully taxable standard-GST `ADDITIONAL_CHARGE` commercial amendment after an issued tax invoice. It requires `payment:manage`, immutable source and target pricing evidence, exact positive GST-inclusive/GST-exclusive effect, complete provider-neutral settlement, and zero earlier adjustment notes against the source invoice.

Persistence now separates `adjustmentType` from `adjustmentReason` and carries mutually exclusive decrease/increase material columns. Schema-version-4 `INCREASING / COMMERCIAL_AMENDMENT` immutable evidence is structurally accepted only at source ordinal `1`, with no refund/predecessor authority and exact standard-GST increase arithmetic. Existing schema versions 1-3 remain explicitly decreasing.

This does not make increasing issuance reachable. There is no schema-version-4 writer, route, action, customer read, accounting/reconciliation projection, HTML, or PDF path yet; existing application projections continue to fail closed on that unsupported evidence. See `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`.

## Remaining boundary

Increasing issuance/delivery and cumulative or mixed-direction increasing adjustments, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustment rules, generic correction/void/reissue, and other jurisdictions remain separate contracts and must fail closed.

Durable customer re-authentication and email delivery/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review also remain required before the broader legal-document lifecycle is considered complete.
