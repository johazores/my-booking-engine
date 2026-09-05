# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance supports full booking-cancellation decreases, first/repeated strictly decreasing commercial amendments, and the first supported increasing commercial amendment under the narrow AU/AUD fully taxable standard-GST contract.

## Reachable authority

- `DECREASING / BOOKING_CANCELLATION`: one attributed successful full-booking refund, schema version 1 / ordinal `1`.
- first `DECREASING / COMMERCIAL_AMENDMENT`: exact applied `REFUND` amendment plus immutable target pricing and provider-neutral settlement, schema version 2 / ordinal `1`.
- repeated `DECREASING / COMMERCIAL_AMENDMENT`: the same authority plus a complete verified predecessor chain, schema version 3 / ordinal `2+`.
- first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied `ADDITIONAL_CHARGE` amendment plus immutable target pricing and complete settlement, no prior adjustment note, schema version 4 / ordinal `1`.

The original tax invoice is never rewritten.

## Direction-aware commercial chain authority

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` and its domain verifier understand the complete commercial legal chain across schema versions 2 through 5 and both supported directions.

Every chain load is tenant-, booking-, and source-invoice-scoped. It independently reloads and validates the immutable source tax invoice, every referenced applied commercial amendment, the exact immutable target-pricing evidence, document fingerprints/material columns, contiguous ordinals, predecessor identity/fingerprint continuity, issuer/recipient continuity, chronology, and the exact positive or negative standard-GST effect.

The verifier also re-proves payment settlement for every historical amendment step. It reconstructs a progressive provider-neutral ledger from payment transactions created no later than each document's issue time: the booking's non-amendment payment truth plus only the commercial-amendment transactions belonging to the verified chain through that ordinal. This lets an earlier legal step still prove its historical after-total after later chain amendments exist, without allowing a future/unissued amendment to rewrite the settlement evidence for an earlier document.

Rows fail closed on mixed legal reasons, unsupported directions/schema versions, gaps, forks, duplicate document/amendment/target authority, cross-tenant/source evidence, baseline drift, target-pricing drift, non-standard GST, unresolved/conflicting settlement, or a net settled amount that does not equal that step's immutable after-total.

Repeated writes continue selecting the verified chain head under the existing tenant/booking/source PostgreSQL transaction advisory lock.

## Repeated-increasing authority foundation

Schema version 5 freezes a repeated increasing document's immediate predecessor id, previous ordinal, document number, issue time, document fingerprint, predecessor after-pricing fingerprint, and exact positive increase effect. PostgreSQL accepts that immutable shape only for an ordinal `2+` `INCREASING / COMMERCIAL_AMENDMENT` row whose material predecessor ordinal is exactly one less.

The shared chain verifier proves schema-version-5 evidence, including decrease-to-increase and increase-to-increase predecessor continuity. `issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote` provides a serializable server-only writer: it requires `payment:manage`, selects the verified chain head under the existing advisory lock, rejects cross-direction same-baseline ambiguity, re-runs cumulative readiness and settlement, allocates the shared AU adjustment-note sequence, persists exact schema-version-5 predecessor-bound evidence, reloads the complete chain, and audits the issuance. Idempotent retries accept only an exact predecessor-bound schema-version-5 increasing row whose immutable snapshot and fingerprint still reconcile. It is intentionally not imported by product orchestration yet.

## Direction-aware product boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` remains the route/UI authority for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes the source invoice, preserves cancellation priority, derives direction only from persisted commercial amendments, and rejects same-baseline ambiguity across `REFUND` and `ADDITIONAL_CHARGE` before offering an action.

The product boundary delegates supported decreasing issuance to the existing verified first/repeated orchestration and supported first-increasing issuance to the serializable schema-version-4 writer. Exact first-increasing retries are re-proved through the existing bounded first-increasing verifier before the idempotent writer is called.

The request body contains only the source invoice number. The browser cannot choose legal direction, money, GST, ordinal, predecessor, provider truth, fingerprint, sequence or issue time. Direction returned to the UI is display-only.

An existing increasing document remains terminal in the reachable product contract. SF does not yet expose the schema-version-5 repeated-increasing writer, a decrease after an increase, or cancellation after an amendment.

## Read, accounting, reconciliation, and delivery safety

Authenticated tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public booking-capability reads authorize tenant slug, encrypted capability, persisted ownership, unexpired principal and tenant-owned booking before legal-document history loads.

`hospitality-issued-adjustment-note-authority-service.ts` is now the shared actor-neutral evidence boundary for adjustment-note projections. It keeps cancellation authority independently bound to the immutable source invoice and successful full refund, and sends every commercial-amendment row — decreasing or increasing — through `verifyHospitalityCommercialAmendmentAdjustmentRows`, which proves membership in the complete schema-version-2-through-5 source chain.

Authenticated detail/register/accounting reads and public capability history now use that same boundary. Reconciliation inherits it through the staff register service, and authenticated/public HTML and deterministic PDF delivery inherit it through their existing verified document reads. Customer-safe projections still omit predecessor/amendment/target ids, fingerprints, actors and provider/payment/refund references unless legally required.

## Next dependency

The serializable repeated-increasing writer and complete downstream read/delivery authority now exist. The next dependency is product orchestration: select a unique applied `ADDITIONAL_CHARGE` against the verified current chain head and call the schema-version-5 writer without letting the browser choose direction, ordinal or predecessor. The product action must stay fail closed until that server availability/issuance path is coherent and validated.

## Remaining boundary

Repeated-increasing product reachability, decrease-after-increase and broader mixed-direction lifecycle semantics, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and fail closed until implemented.
