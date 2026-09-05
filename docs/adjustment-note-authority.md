# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance supports full booking-cancellation decreases and direction-aware cumulative commercial amendments under the narrow AU/AUD fully taxable standard-GST contract.

## Reachable authority

- `DECREASING / BOOKING_CANCELLATION`: one attributed successful full-booking refund, schema version 1 / ordinal `1`.
- first `DECREASING / COMMERCIAL_AMENDMENT`: exact applied `REFUND` amendment plus immutable target pricing and provider-neutral settlement, schema version 2 / ordinal `1`.
- repeated `DECREASING / COMMERCIAL_AMENDMENT`: the same authority plus a complete verified predecessor chain, schema version 3 / ordinal `2+`.
- first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied `ADDITIONAL_CHARGE` amendment plus immutable target pricing and complete settlement, no prior adjustment note, schema version 4 / ordinal `1`.
- repeated `INCREASING / COMMERCIAL_AMENDMENT`: one unique applied `ADDITIONAL_CHARGE` whose before-price is the verified current legal chain head, plus immutable target pricing, complete settlement, and immediate-predecessor authority, schema version 5 / ordinal `2+`.

Supported commercial-amendment chains may move decrease-to-increase, increase-to-increase, increase-to-decrease, or continue decreasing as long as every new step begins at the verified current legal chain head and independently satisfies its directional authority. Cancellation still cannot follow a commercial-amendment chain. The original tax invoice is never rewritten.

## Direction-aware commercial chain authority

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` and its domain verifier understand the complete commercial legal chain across schema versions 2 through 5 and both supported directions.

Every chain load is tenant-, booking-, and source-invoice-scoped. It independently reloads and validates the immutable source tax invoice, every referenced applied commercial amendment, the exact immutable target-pricing evidence, document fingerprints/material columns, contiguous ordinals, predecessor identity/fingerprint continuity, issuer/recipient continuity, chronology, and the exact positive or negative standard-GST effect.

The verifier also re-proves payment settlement for every historical amendment step. It reconstructs a progressive provider-neutral ledger from payment transactions created no later than each document's issue time: the booking's non-amendment payment truth plus only the commercial-amendment transactions belonging to the verified chain through that ordinal. This lets an earlier legal step still prove its historical after-total after later chain amendments exist, without allowing a future/unissued amendment to rewrite the settlement evidence for an earlier document.

Rows fail closed on mixed legal reasons, unsupported directions/schema versions, gaps, forks, duplicate document/amendment/target authority, cross-tenant/source evidence, baseline drift, target-pricing drift, non-standard GST, unresolved/conflicting settlement, or a net settled amount that does not equal that step's immutable after-total.

Repeated writes select the verified chain head under the existing tenant/booking/source PostgreSQL transaction advisory lock.

## Direction-aware repeated authority

Schema version 3 freezes a repeated decreasing document's immediate predecessor authority at ordinal `2+`; the predecessor may itself be decreasing or increasing because the complete shared chain verifier proves its direction/schema and exact after-price before the new `REFUND` can use that price as its legal baseline.

Schema version 5 freezes a repeated increasing document's immediate predecessor id, previous ordinal, document number, issue time, document fingerprint, predecessor after-pricing fingerprint, and exact positive increase effect. PostgreSQL accepts that immutable shape only for an ordinal `2+` `INCREASING / COMMERCIAL_AMENDMENT` row whose material predecessor ordinal is exactly one less.

`issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote` requires `payment:manage`, selects the verified chain head under the advisory lock, rejects cross-direction same-baseline ambiguity, re-runs cumulative readiness and settlement, allocates the shared AU adjustment-note sequence, persists exact schema-version-5 predecessor-bound evidence, reloads the complete chain, and audits the issuance. Idempotent retries accept only an exact predecessor-bound schema-version-5 increasing row whose immutable snapshot and fingerprint still reconcile.

The repeated decreasing writer follows the same chain-head authority pattern for schema version 3 and now accepts a verified increasing predecessor when the new applied `REFUND`, immutable target pricing, standard-GST decrease, chronology, and provider-neutral settlement all reconcile to that head.

## Direction-aware product boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` is the route/UI authority for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes the source invoice, preserves cancellation priority, derives direction only from persisted commercial amendments, verifies any existing commercial history through the complete legal chain, and rejects same-baseline ambiguity across `REFUND` and `ADDITIONAL_CHARGE` before offering an action.

The product boundary evaluates decreasing readiness against the current verified legal baseline even when earlier increasing documents exist. If no supported decrease is available for an existing commercial chain, `getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability` selects exactly one applied `ADDITIONAL_CHARGE` against the verified chain-head after-price, re-parses its immutable target pricing, derives provider-neutral settlement, re-runs cumulative increasing readiness, and requires the server-derived ordinal and predecessor identity to match the verified head. The product service dispatches first/repeated decreasing writes to schema versions 2/3 and increasing ordinal `1`/`2+` to schema versions 4/5.

Same-baseline ambiguity is checked only against amendments applied on or after the current verified legal baseline issue time. This prevents a stale historical amendment from an earlier identical price point from competing with the current legal step while preserving fail-closed current-baseline competition.

Existing issuance retries return only after the referenced commercial-amendment document is proven to belong to the complete tenant/source legal chain. A customer or browser cannot select a different legal step by replaying an amendment id.

The request body contains only the source invoice number. The browser cannot choose legal direction, money, GST, ordinal, predecessor, provider truth, fingerprint, sequence or issue time. Direction and ordinal returned to the UI are display-only.

## Read, accounting, reconciliation, and delivery safety

Authenticated tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public booking-capability reads authorize tenant slug, encrypted capability, persisted ownership, unexpired principal and tenant-owned booking before legal-document history loads.

`hospitality-issued-adjustment-note-authority-service.ts` is the shared actor-neutral evidence boundary for adjustment-note projections. It keeps cancellation authority independently bound to the immutable source invoice and successful full refund, and sends every commercial-amendment row — decreasing or increasing — through `verifyHospitalityCommercialAmendmentAdjustmentRows`, which proves membership in the complete schema-version-2-through-5 source chain.

Authenticated detail/register/accounting reads and public capability history use that same boundary. Reconciliation inherits it through the staff register service, and authenticated/public HTML and deterministic PDF delivery inherit it through their existing verified document reads. Customer-safe projections omit predecessor/amendment/target ids, fingerprints, actors and provider/payment/refund references unless legally required.

## Remaining boundary

Cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and fail closed until implemented.
