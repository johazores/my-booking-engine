# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF has a fail-closed server readiness contract, immutable persistence foundation, serializable server writer, bounded post-issuance read-authority verifier, and direction-aware legal-document/PDF/accounting projection contracts for the first Australian hospitality commercial amendment that increases consideration after an Australian tax invoice has been issued.

Increasing issuance is still not product-reachable. The current authenticated/public adjustment-note read services, reconciliation traversal, API route, register/detail UI and primary action intentionally do not admit schema-version-4 evidence yet. This prevents the writer from creating a legal document before every reachable read path consumes the same independent authority proof.

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
- the increase GST equal to one-eleventh of the GST-inclusive increase under the supported standard-GST contract;
- provider-neutral settlement state `READY_TO_APPLY`, zero remaining adjustment, exact settled increase, and net settled money equal to the amended after-total; and
- zero prior adjustment notes against the source invoice.

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` requires `payment:manage` and independently reloads the exact tenant-owned source invoice, commercial amendment, target pricing evidence, prior-adjustment count, and complete booking payment ledger inside a serializable read. The caller cannot supply provider truth, amount, GST, pricing fingerprints, settlement state, document numbering, sequence, issue time, or prior-adjustment authority.

## Immutable persistence foundation

`HospitalityIssuedAdjustmentNote` separates legal effect from reason with material `adjustmentType`, mutually exclusive decrease and increase columns, and the existing tenant/source sequence and uniqueness constraints. Schema versions 1-3 remain decreasing.

`HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot` is schema version 4. It is first-adjustment-only, uses `adjustmentType = INCREASING`, freezes the source invoice, applied amendment, immutable target-pricing ids/fingerprints, before/after GST-inclusive evidence and derived increase, and contains no refund or predecessor authority. Its parser recomputes the increase from before/after evidence and fails closed if persisted effect fields drift.

PostgreSQL snapshot checks admit schema version 4 only for `COMMERCIAL_AMENDMENT`, source ordinal `1`, no predecessor/refund authority, zero decrease columns, positive exact standard-GST increase columns, and matching immutable JSON evidence.

## Serializable writer boundary

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is the server-only schema-version-4 writer. It requires `payment:manage`, validates all identifiers, and performs the authoritative write in a serializable transaction with bounded retries for uniqueness/serialization conflicts.

Before allocating a document number it independently reloads and verifies the immutable source tax invoice, exact applied amendment, exactly one immutable target-pricing record, the complete provider-neutral payment ledger, and zero earlier adjustment notes. It also fails closed when another applied refund or additional-charge amendment competes for the same immutable source-invoice baseline; the caller cannot choose which competing commercial event becomes legal-document authority.

The writer allocates the shared tenant `AU / ADJUSTMENT_NOTE` sequence server-side, derives issue time and all GST/money from persisted evidence, writes schema-version-4 `INCREASING` evidence with zero decrease material columns, immediately reparses/revalidates the created record, and records a tenant-scoped audit event. Exact retries are idempotent by the tenant-owned commercial-amendment authority and revalidate the persisted snapshot before returning it.

## Post-issuance read authority

`verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows` is the reusable post-issuance authority verifier. It is intentionally actor-neutral so authenticated staff reads and public capability-owned reads can call it only after their own authorization boundaries have succeeded.

The verifier accepts at most 100 references per batch and re-queries the requested rows under the supplied `organizationId`. It only admits `AU / ADJUSTMENT_NOTE / INCREASING / COMMERCIAL_AMENDMENT` schema-version-4 rows and revalidates zero decrease material columns, exact positive increase material columns, immutable document fingerprint, ordinal `1`, and absence of refund/predecessor authority.

It then independently reloads and revalidates the source tax invoice, exact applied commercial amendment, exact target pricing record, complete tenant+booking payment ledger, and all adjustment rows for the source invoice. Authority fails closed unless the increasing note is the sole adjustment against that source invoice. The same readiness contract is recomputed from persisted evidence with the pre-issuance prior-adjustment count fixed at zero, while the persisted snapshot must exactly match amendment application time, before/after GST and totals, pricing fingerprints, source invoice number/time/fingerprint, party fingerprints, target id, and issue chronology.

The verifier returns only legal-resource references and fingerprints needed by server callers; it does not project customer data, provider references, payment references, credentials or secrets.

## Direction-aware immutable projections

`createHospitalityIssuedAdjustmentNoteDocument` now has a schema-version-aware increasing commercial-amendment projection in addition to existing cancellation and decreasing commercial projections. The projection always carries mutually exclusive decrease and increase effects so downstream UI/delivery code cannot accidentally label an increase as a decrease.

`createHospitalityAdjustmentNotePdf` now validates and renders either a decreasing or increasing commercial adjustment. It rejects mixed directional effects, requires the chosen effect to reconcile GST-exclusive + GST = GST-inclusive total, validates the before/after price direction, keeps booking cancellation decreasing-only, and renders direction-correct labels and legal explanation text. The existing deterministic Windows-1252 limitation remains fail closed.

The adjustment accounting CSV contract now has an explicit `adjustment_type` plus separate decrease and increase columns. Existing decreasing callers remain source-compatible while increasing rows must provide zero decrease values and a positive reconciled increase. Mixed-direction rows are rejected. Provider/payment references remain absent from the export contract.

## Product boundary

The writer and the new read/projection foundations remain deliberately disconnected from the current product route. The authenticated/public adjustment-note read services still need to classify schema-version-4 rows, invoke `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows`, and feed the direction-aware document/accounting/PDF projections. Reconciliation will inherit the authority once those register reads are integrated and continue to fail closed on unsupported evidence in the meantime.

Only after those reachable reads are coherent should the existing commercial-amendment API and tax-invoice action use server-derived direction-aware availability and call the increasing writer. Cumulative/mixed-direction increasing semantics remain a later separate contract.

## Validation boundary

Dependency-free source-contract tests cover the new bounded tenant-scoped read authority, immutable source/target/settlement re-verification, sole-adjustment requirement, customer/provider-data exclusion, and direction-aware projection invariants. Focused PDF and accounting domain tests add increasing success cases plus mixed/unreconciled effect rejection while preserving existing decreasing behavior.

Full Node 24 repository validation, Prisma schema/migration execution, PostgreSQL integration/concurrency execution, product read-path integration, and legal review remain required before increasing product issuance is opened.
