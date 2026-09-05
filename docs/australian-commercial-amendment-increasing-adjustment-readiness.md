# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF supports a deliberately narrow Australian hospitality increasing-adjustment contract after an Australian tax invoice has been issued. Reachable production issuance covers first and repeated `ADDITIONAL_CHARGE` adjustments whose legal baseline is the complete verified commercial adjustment-note chain head.

The contract remains AU/AUD and fully taxable standard GST. Browser/provider input cannot supply GST, legal money, pricing fingerprints, settlement truth, numbering, sequence, issue time, legal direction, ordinal, or predecessor authority.

## Official Australian basis

The contract was reviewed against ATO GSTR 2013/2 on 5 September 2026. That ruling describes a change in consideration as an adjustment event and distinguishes increasing and decreasing GST adjustments. Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

## Direction-aware cumulative readiness

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` requires an `APPLIED` `ADDITIONAL_CHARGE` amendment, exact immutable target pricing, positive standard-GST effect, and provider-neutral settlement that reconciles to the amendment after-price.

For ordinal `1`, the amendment before-price must equal the immutable source invoice. For ordinal `2+`, readiness requires the complete prior adjustment-note price chain. Prior steps may be increasing or decreasing, but each must preserve contiguous verified price/chronology authority and the candidate before-price must equal the verified chain-head after-price.

## Shared post-issuance chain verification

The shared tenant-scoped commercial chain parses and verifies schema version 2 first-decreasing, schema 3 repeated-decreasing, schema 4 first-increasing, and schema 5 repeated-increasing evidence. It independently proves source invoice identity/fingerprint, ordinal/predecessor continuity, direction/schema compatibility, amendment and target-pricing evidence, exact standard-GST effect, unique authority, chronology, issuer/recipient continuity, and issue-time settlement.

Historical commercial verification can tolerate one structurally terminal schema-version-6 booking cancellation after the chain without treating it as a commercial member. The strict locked write path does not permit any commercial document after that terminal event.

## Immutable evidence and product reachability

Schema version 4 is the first-increasing document at ordinal `1`. Schema version 5 is repeated increasing at ordinal `2+` and freezes immediate predecessor ID, prior ordinal, document number, issue time, document fingerprint, predecessor after-pricing fingerprint, and the exact positive effect.

`getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability` reloads the tenant-owned source invoice and complete commercial chain, derives the current baseline from the verified predecessor, selects exactly one eligible `ADDITIONAL_CHARGE`, re-parses target pricing, derives provider-neutral settlement, and re-runs cumulative readiness. The schema-version-5 writer repeats authority under a serializable transaction and advisory chain lock.

The shared product boundary evaluates supported decreasing readiness against any verified commercial chain before falling back to repeated increasing readiness. Current-baseline cross-direction ambiguity fails closed.

## Terminal cancellation interaction

A later supported full booking cancellation is represented separately by schema version 6. It uses the verified current commercial chain head as its legal before-price, re-proves the issue-time provider-neutral refund set and zero settlement, persists predecessor-bound cancellation evidence, and closes the commercial write chain permanently.

Authenticated/public detail and history, accounting, reconciliation, HTML, and deterministic PDF surfaces consume the shared adjustment authority, so mixed-direction commercial rows and terminal cancellation are exposed only after their independent legal-evidence contracts verify.

## Validation boundary

Dependency-free coverage includes first/repeated increasing readiness, decrease-to-increase, increase-to-increase, increase-to-decrease, mixed-direction predecessor continuity, direction/schema mismatches, target-evidence drift, effect columns, chronology, settlement failure, server-only candidate selection, browser-authority exclusion, repeated-increasing dispatch, and terminal cancellation interaction/source-contract coverage.

Full repository validation still requires the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.

## Remaining production boundary

Mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, full Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review remain separate production work.
