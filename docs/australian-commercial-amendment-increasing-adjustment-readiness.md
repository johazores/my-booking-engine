# Australian commercial-amendment increasing-adjustment readiness

## Purpose

SF now has a fail-closed server readiness contract for the first Australian hospitality commercial amendment that increases consideration after an Australian tax invoice has already been issued. This is readiness only: it does not create or expose an increasing adjustment note yet.

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

The first-only rule is intentional. Existing persisted predecessor chains are decreasing-only. SF does not infer mixed-direction ordering, cancellation-after-amendment behavior, or cumulative increasing semantics from the current decrease-specific schema.

## Server boundary

`assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` requires `payment:manage` and performs one serializable tenant-scoped read. It independently resolves and verifies:

- the exact AU tax invoice by organization + booking + document number;
- immutable tax-invoice snapshot/material columns/document fingerprint;
- the exact commercial amendment by organization + booking + amendment id;
- exactly one tenant-owned `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row and its canonical breakdown;
- all adjustment-note count evidence for the same organization + booking + source invoice; and
- the complete tenant-owned booking payment ledger through the provider-neutral commercial-amendment settlement domain.

The caller cannot provide provider truth, amount, currency, source payment identity, GST, pricing fingerprints, settlement state, legal direction, document number, sequence, issue time, or prior-adjustment authority.

## Persistence and product boundary

No increasing adjustment-note route, action, number, PDF, register row, accounting row, public document, or reconciliation claim is exposed by this readiness work.

`HospitalityIssuedAdjustmentNote` and its current PostgreSQL snapshot checks remain decrease-specific: material columns are named `decrease*`, current commercial snapshots identify `adjustmentType = DECREASING`, and the verified predecessor-chain domain requires every commercial step to be a standard-GST decrease. Reusing those fields for an increase would make persisted legal evidence misleading.

The next dependency is a deliberate persistence evolution that represents adjustment direction and effect without mutating schema-version-1/2/3 evidence, followed by immutable increasing document evidence, serializable issuance, chain/mixed-direction rules, authenticated/public reads, accounting/reconciliation, HTML/PDF delivery, and only then a real product action.

## Validation boundary

Focused dependency-free tests cover valid additional-charge readiness, unsupported refund direction, prior-adjustment rejection, source-baseline drift, target-evidence drift, non-standard GST, incomplete settlement, chronology/status, and delta mismatch.

Full Node 24 repository validation, Prisma schema/migration checks, PostgreSQL integration/concurrency execution, and legal review remain required before issuance is opened.
