# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF has a fail-closed server readiness contract, immutable persistence foundation, and serializable server writer for the first Australian hospitality commercial amendment that increases consideration after an Australian tax invoice has been issued. Increasing issuance is still not product-reachable: authenticated/public reads, accounting/reconciliation, HTML/PDF delivery, the API route, and the primary action intentionally continue to reject or avoid schema-version-4 evidence until they share the same verified authority boundary.

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

## Product boundary

The writer is deliberately not imported by the current adjustment-note API route. No increasing primary action, customer document, register/accounting row, reconciliation claim, HTML rendering, or PDF is exposed yet. This prevents a schema-version-4 legal record from becoming product-reachable before every read and delivery surface can independently re-prove its source invoice, amendment, target pricing, settlement, material columns, and document fingerprint.

The next dependency is to broaden the shared authenticated/public adjustment-note read authority for first-increasing rows, then extend accounting/reconciliation and deterministic HTML/PDF projection. Only after those projections fail closed correctly should the existing commercial-amendment route and tax-invoice action use server-derived direction-aware availability. Cumulative/mixed-direction increasing semantics remain a later separate contract.

## Validation boundary

Dependency-free tests cover increasing readiness, schema-version-4 snapshot round-trip/fingerprint behavior, migration invariants, and the new writer source contract: tenant permission, serializable write/retry behavior, shared sequence allocation, zero-decrease/positive-increase persistence, post-write immutable validation, same-baseline ambiguity rejection, provider-neutral settlement revalidation, idempotency, safe audit data, and the intentional absence of current route reachability.

Full Node 24 repository validation, Prisma schema/migration execution, PostgreSQL integration/concurrency execution, and legal review remain required before increasing product issuance is opened.
