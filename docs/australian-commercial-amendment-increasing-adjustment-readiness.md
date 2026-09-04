# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF has a fail-closed Australian foundation for the first hospitality commercial amendment that increases consideration after an Australian tax invoice has been issued. The foundation now includes legal/commercial readiness, immutable schema-version-4 persistence, a serializable server writer, bounded post-issuance authority verification, authenticated staff reads, public capability-owned reads, direction-aware register/detail/history rendering, accounting export, reconciliation traversal, HTML/print projection, and deterministic PDF projection.

Increasing issuance is still intentionally not product-reachable. The existing commercial-amendment API and tax-invoice primary action do not call the increasing writer yet. This preserves the rule that no legal document is issued until every reachable read and delivery path can independently re-prove the same authority.

The contract remains deliberately narrow: AU/AUD, fully taxable standard GST, one applied `ADDITIONAL_CHARGE` amendment, one exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record, complete provider-neutral settlement, and no earlier adjustment note against the source tax invoice. Cumulative or mixed-direction increasing semantics are not inferred from the existing decreasing chain.

## Official Australian basis

The contract was reviewed against ATO GSTR 2013/2 on 5 September 2026. That ruling describes a change in consideration as an adjustment event, distinguishes increasing and decreasing GST adjustments, and explains the adjustment-note rules that can apply when an adjustment arises after a tax invoice. Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

## Readiness authority

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` is dependency-free legal/commercial validation. It requires:

- a valid immutable AU/AUD source tax-invoice price with fully taxable standard GST;
- an `APPLIED` commercial amendment with direction `ADDITIONAL_CHARGE` and a strictly positive persisted delta;
- amendment application not earlier than source-invoice issue time;
- amendment before-price equal to the immutable source-invoice price and pricing fingerprint;
- amendment after-price equal to the exact immutable target pricing evidence;
- exact positive total, GST, and GST-exclusive increases;
- increase GST equal to one-eleventh of the GST-inclusive increase under the supported standard-GST contract;
- provider-neutral settlement state `READY_TO_APPLY`, zero remaining adjustment, exact settled increase, and net settled money equal to the amended after-total; and
- zero prior adjustment notes against the source invoice.

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` requires `payment:manage` and independently reloads the exact tenant-owned source invoice, commercial amendment, target pricing evidence, prior-adjustment count, and complete booking payment ledger inside a serializable read. The caller cannot supply provider truth, amount, GST, pricing fingerprints, settlement state, document numbering, sequence, issue time, or prior-adjustment authority.

## Immutable persistence and writer

`HospitalityIssuedAdjustmentNote` separates legal effect from reason with material `adjustmentType`, mutually exclusive decrease and increase columns, and the existing tenant/source sequence and uniqueness constraints. Schema versions 1-3 remain decreasing.

`HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot` is schema version 4. It is first-adjustment-only, uses `adjustmentType = INCREASING`, freezes the source invoice, applied amendment, immutable target-pricing ids/fingerprints, before/after GST-inclusive evidence and derived increase, and contains no refund or predecessor authority. Its parser recomputes the increase from before/after evidence and fails closed if persisted effect fields drift.

PostgreSQL snapshot checks admit schema version 4 only for `COMMERCIAL_AMENDMENT`, source ordinal `1`, no predecessor/refund authority, zero decrease columns, positive exact standard-GST increase columns, and matching immutable JSON evidence.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the server-only schema-version-4 writer. It requires `payment:manage`, validates all identifiers, and performs the authoritative write in a serializable transaction with bounded retries for uniqueness/serialization conflicts. Before allocating a number it independently reloads the immutable source invoice, exact applied amendment, exactly one target-pricing record, complete provider-neutral payment ledger, and zero earlier adjustment notes. It also rejects competing applied amendments sharing the same immutable source baseline.

The writer allocates the shared tenant `AU / ADJUSTMENT_NOTE` sequence server-side, derives issue time and all GST/money from persisted evidence, writes zero decrease and positive increase material columns, immediately reparses/revalidates the created record, remains idempotent by tenant-owned commercial-amendment authority, and records a tenant-scoped audit event.

## Post-issuance authority

`verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows` is the reusable actor-neutral post-issuance verifier. It accepts at most 100 references per call, re-queries them under the supplied `organizationId`, and admits only `AU / ADJUSTMENT_NOTE / INCREASING / COMMERCIAL_AMENDMENT` schema-version-4 rows.

For every row it independently re-proves the source tax invoice, exact applied commercial amendment, unique immutable target-pricing record, complete tenant+booking payment ledger, sole-adjustment authority, material increase columns, document fingerprint, source baseline uniqueness, chronology, party fingerprints, and standard-GST readiness. It returns only legal-resource identifiers/fingerprints needed by server callers and never projects customer, provider, payment, credential, or secret data.

Authenticated adjustment-note reads now classify increasing and decreasing evidence separately. They require both `booking:read` and `payment:read`, tenant-scope every database query, independently validate the source invoice for every row, run decreasing chain verification for schema versions 2/3, and run the increasing verifier in bounded batches for schema version 4. Cancellation refund authority remains separate.

Public tax-document history keeps the existing encrypted booking capability, persisted ownership, unexpired principal, active booking and tenant-slug boundary. Only after that authorization succeeds does it classify and verify schema-version-4 increasing evidence. Public projections omit internal amendment, target-pricing, payment, provider, predecessor, fingerprint, credential and secret fields.

## Direction-aware delivery

`createHospitalityIssuedAdjustmentNoteDocument` carries mutually exclusive decrease and increase effects. Authenticated register/detail pages and public booking history render the server-derived adjustment direction, before/after price, GST-exclusive effect, GST effect and GST-inclusive effect without presenting an increase as a decrease.

The accounting CSV has an explicit `adjustment_type` plus separate decrease and increase columns. Authenticated export maps schema-version-4 evidence into the increasing branch only after the same authority verification used by detail/register reads. The reconciliation service consumes those verified paginated reads, so an increasing row is included only when the complete legal/commercial authority succeeds.

Authenticated and public PDF routes consume the verified direction-aware document projection. `createHospitalityAdjustmentNotePdf` rejects mixed directional effects, requires GST-exclusive + GST = GST-inclusive effect, validates before/after direction, keeps booking cancellation decreasing-only, and renders direction-correct labels. The deterministic Windows-1252 limitation remains fail closed.

## Product boundary

The first-increasing legal document is now readable and deliverable through the same production integrity boundary as other supported Australian tax documents, but the writer remains deliberately disconnected from the product action/API. No browser input can currently request an increasing adjustment note.

The next coherent dependency is direction-aware issuance orchestration: the existing commercial-amendment route and tax-invoice action should obtain server-derived availability, distinguish the supported first-increasing case from the existing decreasing chain, and call the increasing writer only after revalidating the same immutable authority in the write transaction. Cumulative/mixed-direction increasing semantics remain a separate contract and must continue to fail closed.

## Validation boundary

Focused dependency-free source-contract coverage verifies staff classification/batching, tenant-scoped public capability reads, separate increase/decrease accounting projection, direction-aware staff register/detail rendering, and direction-aware public history/print/PDF payloads. The modified server TypeScript passes the available Node syntax parser; an isolated TypeScript parser pass reports only expected unresolved repository/framework dependencies in this environment.

Full Node 24 repository validation, Prisma schema/migration/drift execution, live PostgreSQL authority/concurrency tests, production build, and jurisdiction/legal review remain required before increasing issuance is opened.
