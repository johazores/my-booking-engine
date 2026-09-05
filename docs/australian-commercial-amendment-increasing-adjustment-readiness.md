# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF supports a deliberately narrow Australian hospitality increasing-adjustment contract after an Australian tax invoice has been issued. Reachable production issuance remains the already-implemented first `ADDITIONAL_CHARGE` adjustment. This foundation now also defines the evidence required for a later increasing adjustment without making that later write product-reachable.

The contract remains AU/AUD and fully taxable standard GST. Browser/provider input cannot supply GST, legal money, pricing fingerprints, settlement truth, numbering, sequence, issue time, legal direction, ordinal, or predecessor authority.

## Official Australian basis

The contract was reviewed against ATO GSTR 2013/2 on 5 September 2026. That ruling describes a change in consideration as an adjustment event and distinguishes increasing and decreasing GST adjustments. Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

## Direction-aware cumulative readiness foundation

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` still requires an `APPLIED` `ADDITIONAL_CHARGE` amendment, exact immutable target pricing, positive standard-GST effect, and provider-neutral settlement that reconciles to the amendment after-price.

For ordinal `1`, the amendment before-price must equal the immutable source invoice.

For ordinal `2+`, readiness now requires the complete prior adjustment-note price chain. The chain must be contiguous, uniquely identified, chronologically non-regressing, and each prior before-price must equal the preceding after-price. A prior step may be increasing or decreasing, but every step must preserve the same supported AU/AUD standard-GST contract. The candidate amendment before-price must equal the verified chain-head after-price and cannot predate the predecessor document.

If prior documents exist but their verified chain evidence is not supplied, readiness remains closed. It returns no usable ordinal or predecessor authority.

## Immutable evidence

Schema version 4 remains the first-increasing immutable document contract at source ordinal `1`.

Schema version 5 is now defined for a future repeated increasing commercial adjustment at ordinal `2+`. It freezes the immediate predecessor adjustment-note id, prior ordinal, document number, issue time, document fingerprint, and predecessor after-pricing fingerprint. The new PostgreSQL snapshot constraint admits schema version 5 only for `INCREASING / COMMERCIAL_AMENDMENT` rows with exact predecessor-ordinal continuity, zero decrease evidence, positive increase evidence, and before-pricing continuity.

Existing schema-version-1 cancellation, schema-version-2/3 decreasing-commercial, and schema-version-4 first-increasing evidence remain accepted by the replacement database constraint.

## Reachability boundary

Repeated increasing issuance is intentionally not product-reachable yet.

The current product orchestration still treats an existing increasing document as terminal, the current first-increasing writer still supplies zero prior adjustments, and current post-issuance increasing verification remains first-only. This prevents schema-version-5 evidence from being written before the general commercial chain verifier, serializable repeated-increasing writer, authenticated/public reads, accounting, reconciliation, HTML/PDF delivery, and retry behavior can all verify the same predecessor authority.

## Validation boundary

Dependency-free domain tests cover first and repeated readiness, decrease-to-increase and increase-to-increase predecessor chains, missing/invalid predecessor evidence, baseline drift, chronology, target evidence, standard GST, and settlement. Snapshot tests cover schema versions 4 and 5, exact predecessor continuity, chronology, fingerprints, canonical round-trip, and mutually exclusive directional effects. A source-contract test covers the PostgreSQL v1-v5 snapshot branches and confirms repeated increasing remains product-unreachable.

Full repository validation still requires the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.

## Remaining production boundary

The next dependency is to extend the verified commercial adjustment chain and post-issuance read authority across both directions, then add a serializable repeated-increasing writer and expose it only through the existing server-derived product orchestration. Cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, full Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review remain separate production work.