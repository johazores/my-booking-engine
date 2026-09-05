# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF supports a deliberately narrow Australian hospitality increasing-adjustment contract after an Australian tax invoice has been issued. Reachable production issuance now covers the first `ADDITIONAL_CHARGE` adjustment and a later supported increasing adjustment whose legal baseline is the complete verified commercial adjustment-note chain head.

The contract remains AU/AUD and fully taxable standard GST. Browser/provider input cannot supply GST, legal money, pricing fingerprints, settlement truth, numbering, sequence, issue time, legal direction, ordinal, or predecessor authority.

## Official Australian basis

The contract was reviewed against ATO GSTR 2013/2 on 5 September 2026. That ruling describes a change in consideration as an adjustment event and distinguishes increasing and decreasing GST adjustments. Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

## Direction-aware cumulative readiness

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` requires an `APPLIED` `ADDITIONAL_CHARGE` amendment, exact immutable target pricing, positive standard-GST effect, and provider-neutral settlement that reconciles to the amendment after-price.

For ordinal `1`, the amendment before-price must equal the immutable source invoice.

For ordinal `2+`, readiness requires the complete prior adjustment-note price chain. The chain must be contiguous, uniquely identified, chronologically non-regressing, and each prior before-price must equal the preceding after-price. A prior step may be increasing or decreasing, but every step must preserve the same supported AU/AUD standard-GST contract. The candidate amendment before-price must equal the verified chain-head after-price and cannot predate the predecessor document.

If prior documents exist but their verified chain evidence is not supplied, readiness remains closed. It returns no usable ordinal or predecessor authority.

## Shared post-issuance chain verification

The shared tenant-scoped commercial adjustment chain parses and verifies both decreasing and increasing immutable documents:

- schema version 2: first decreasing commercial adjustment;
- schema version 3: repeated decreasing commercial adjustment;
- schema version 4: first increasing commercial adjustment;
- schema version 5: repeated increasing commercial adjustment.

The chain verifier independently proves source invoice identity/fingerprint, exact ordinal and predecessor continuity, direction/schema compatibility, immutable amendment and target-pricing evidence, exact standard-GST directional effect, unique document/amendment/target authority, chronology, issuer/recipient continuity, and settlement.

Settlement verification is progressive. For each historical ordinal SF derives provider-neutral settlement from payment transactions created no later than that document's issue time: the booking's base payment ledger plus only commercial-amendment transactions in the verified legal chain through that ordinal. Later chain transactions do not mutate the historical settlement baseline of an earlier legal document, while unresolved/conflicting payment truth at the relevant step still fails closed.

## Immutable evidence

Schema version 4 remains the first-increasing immutable document contract at source ordinal `1`.

Schema version 5 defines a repeated increasing commercial adjustment at ordinal `2+`. It freezes the immediate predecessor adjustment-note id, prior ordinal, document number, issue time, document fingerprint, and predecessor after-pricing fingerprint. PostgreSQL admits schema version 5 only for `INCREASING / COMMERCIAL_AMENDMENT` rows with exact predecessor-ordinal continuity, zero decrease evidence, positive increase evidence, and before-pricing continuity.

Existing schema-version-1 cancellation, schema-version-2/3 decreasing-commercial, and schema-version-4 first-increasing evidence remain accepted by the database contract.

## Product reachability

Repeated increasing issuance is product-reachable only through server-derived chain-head readiness.

`getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability` requires `payment:manage`, reloads the tenant-owned source invoice and complete commercial legal chain, then derives the current price baseline from the verified predecessor. It searches applied amendments across both `REFUND` and `ADDITIONAL_CHARGE` directions on that exact baseline and exposes an action only when exactly one candidate exists and it is `ADDITIONAL_CHARGE`.

Before returning the action, the service re-parses the immutable target-pricing breakdown, derives provider-neutral settlement, re-runs cumulative increasing readiness with the complete predecessor set, and requires the returned ordinal, predecessor id, document number and document fingerprint to equal the verified chain head. The schema-version-5 writer repeats authority checks under its serializable transaction and advisory chain lock before persistence.

A decreasing chain can therefore transition to one supported increasing step, and an increasing head can receive another increasing step. Decrease-after-increase and cancellation-after-amendment remain deliberately closed.

Authenticated/public detail and history, accounting, reconciliation, HTML and deterministic PDF surfaces already consume the shared schema-version-2-through-5 authority, so a schema-version-5 row is not exposed unless the complete legal chain independently verifies.

## Validation boundary

Dependency-free domain/source-contract coverage includes first increasing, decrease-to-increase, increase-to-increase, direction/schema mismatches, predecessor fingerprint drift, duplicate immutable authority, target-evidence drift, mutually exclusive effect columns, chronology, settlement failure, server-only candidate selection, browser-authority exclusion, and repeated-increasing product dispatch.

Full repository validation still requires the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.

## Remaining production boundary

Decrease-after-increase semantics, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, full Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review remain separate production work.
