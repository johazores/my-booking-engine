# Australian commercial-amendment increasing-adjustment readiness

## Purpose

SF now has a fail-closed server readiness contract and immutable persistence foundation for the first Australian hospitality commercial amendment that increases consideration after an Australian tax invoice has already been issued. This is not reachable issuance yet: no API or UI can create or expose an increasing adjustment note.

The contract remains deliberately narrow: AU/AUD, fully taxable standard GST, one applied `ADDITIONAL_CHARGE` amendment, one exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record, complete provider-neutral settlement, and no earlier adjustment note against the source tax invoice.

## Official Australian basis

The contract was reviewed against current ATO adjustment guidance on 5 September 2026:

- ATO GSTR 2013/2 legal database: https://www.ato.gov.au/law/view/document?LocID=%22GST%2FGSTR20132%2FNAT%2FATO%2Ffp4%22

The ruling describes a change in consideration as an adjustment event, distinguishes increasing and decreasing GST adjustments, and states that a supplier must issue an adjustment note within the applicable 28-day rule when an adjustment arises and the supplier issued or was requested to issue a tax invoice. It also states that an adjustment note does not need to be held to attribute an increasing adjustment. SF therefore treats increasing-document support as a deliberate legal-document contract rather than assuming that a new tax invoice or an ordinary payment receipt is automatically the correct artifact.

Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

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

The first-only rule is intentional. Existing predecessor-chain semantics are decreasing-only. SF does not infer mixed-direction ordering, cancellation-after-amendment behavior, or cumulative increasing semantics from the current decrease chain.

## Server boundary

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` requires `payment:manage` and performs one serializable tenant-scoped read. It independently resolves and verifies:

- the exact AU tax invoice by organization + booking + document number;
- immutable tax-invoice snapshot/material columns/document fingerprint;
- the exact commercial amendment by organization + booking + amendment id;
- exactly one tenant-owned `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row and its canonical breakdown;
- all adjustment-note count evidence for the same organization + booking + source invoice; and
- the complete tenant-owned booking payment ledger through the provider-neutral commercial-amendment settlement domain.

The caller cannot provide provider truth, amount, currency, source payment identity, GST, pricing fingerprints, settlement state, legal direction, document number, sequence, issue time, or prior-adjustment authority.

## Immutable persistence foundation

`HospitalityIssuedAdjustmentNote` now separates legal effect from reason with an explicit material `adjustmentType`. Existing rows default to `DECREASING`; new material `increaseSubtotalMinor`, `increaseTaxMinor`, and `increaseTotalMinor` columns default to zero so existing cancellation and decreasing-commercial writers remain compatible.

The database money check requires exactly one supported effect: decreasing rows retain positive standard-GST decrease columns and zero increase columns; structurally supported increasing rows require zero decrease columns plus a positive exact standard-GST increase.

`HospitalityIssuedCommercialAmendmentIncreasingAdjustmentNoteSnapshot` is schema version 4. It is first-adjustment-only, uses `adjustmentType = INCREASING`, freezes the exact source invoice, applied amendment, immutable target-pricing ids/fingerprints, before/after GST-inclusive evidence and derived increase, and deliberately contains no refund or predecessor authority. Its parser recomputes the canonical increase from before/after evidence and fails closed if persisted effect fields drift.

PostgreSQL snapshot checks structurally admit schema version 4 only for `COMMERCIAL_AMENDMENT`, source ordinal `1`, no predecessor authority, no decrease snapshot fields, exact material increase columns, and exact standard-GST before/after arithmetic. Existing schema versions 1, 2 and 3 remain explicitly decreasing and unchanged in meaning.

## Product boundary

No increasing adjustment-note writer, API route, primary action, customer document, PDF, register/accounting row, public history item, or reconciliation claim is exposed by this foundation. Existing application read and delivery paths still accept only cancellation and decreasing commercial documents; an unexpected schema-version-4 row therefore remains fail closed.

The next dependency is a serializable increasing writer that consumes the readiness result, allocates the shared tenant AU adjustment-note sequence, writes schema-version-4 evidence, revalidates the persisted document, and remains idempotent by commercial-amendment authority. Only after that should authenticated/public reads, accounting/reconciliation, HTML/PDF delivery and the real product action be broadened. Cumulative/mixed-direction increasing semantics remain a later separate contract.

## Validation boundary

Focused dependency-free tests cover valid additional-charge readiness, unsupported refund direction, prior-adjustment rejection, source-baseline drift, target-evidence drift, non-standard GST, incomplete settlement, chronology/status, delta mismatch, immutable schema-version-4 snapshot round-trip/fingerprint behavior, hidden decreasing/predecessor authority rejection, and the migration contract preserving schema versions 1-3.

Full Node 24 repository validation, Prisma schema/migration execution, PostgreSQL integration/concurrency execution, and legal review remain required before issuance is opened.
