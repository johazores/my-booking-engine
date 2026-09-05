# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance supports full booking-cancellation decreases, first/repeated strictly decreasing commercial amendments, and the first supported increasing commercial amendment under the narrow AU/AUD fully taxable standard-GST contract.

## Reachable authority

- `DECREASING / BOOKING_CANCELLATION`: one attributed successful full-booking refund, schema version 1 / ordinal `1`.
- first `DECREASING / COMMERCIAL_AMENDMENT`: exact applied `REFUND` amendment plus immutable target pricing and provider-neutral settlement, schema version 2 / ordinal `1`.
- repeated `DECREASING / COMMERCIAL_AMENDMENT`: the same authority plus a complete verified predecessor chain, schema version 3 / ordinal `2+`.
- first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied `ADDITIONAL_CHARGE` amendment plus immutable target pricing and complete settlement, no prior adjustment note, schema version 4 / ordinal `1`.

The original tax invoice is never rewritten.

## Direction-aware commercial chain authority

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` and its domain verifier now understand the complete commercial legal chain across schema versions 2 through 5 and both supported directions.

Every chain load is tenant-, booking-, and source-invoice-scoped. It independently reloads and validates the immutable source tax invoice, every referenced applied commercial amendment, the exact immutable target-pricing evidence, document fingerprints/material columns, contiguous ordinals, predecessor identity/fingerprint continuity, issuer/recipient continuity, chronology, and the exact positive or negative standard-GST effect.

The verifier also re-proves payment settlement for every historical amendment step. It reconstructs a progressive provider-neutral ledger from the booking's non-amendment payment truth plus only the commercial-amendment transactions belonging to the verified chain through that ordinal. This lets an earlier legal step still prove its historical after-total after later chain amendments exist, without allowing a future/unissued amendment to rewrite the settlement evidence for an earlier document.

Rows fail closed on mixed legal reasons, unsupported directions/schema versions, gaps, forks, duplicate document/amendment/target authority, cross-tenant/source evidence, baseline drift, target-pricing drift, non-standard GST, unresolved/conflicting settlement, or a net settled amount that does not equal that step's immutable after-total.

Repeated writes continue selecting the verified chain head under the existing tenant/booking/source PostgreSQL transaction advisory lock.

## Repeated-increasing authority foundation

Schema version 5 freezes a repeated increasing document's immediate predecessor id, previous ordinal, document number, issue time, document fingerprint, predecessor after-pricing fingerprint, and exact positive increase effect. PostgreSQL accepts that immutable shape only for an ordinal `2+` `INCREASING / COMMERCIAL_AMENDMENT` row whose material predecessor ordinal is exactly one less.

The shared chain verifier can now prove schema-version-5 evidence, including decrease-to-increase and increase-to-increase predecessor continuity. This is still verification authority, not a reachable repeated-increasing writer.

## Direction-aware product boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` remains the route/UI authority for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes the source invoice, preserves cancellation priority, derives direction only from persisted commercial amendments, and rejects same-baseline ambiguity across `REFUND` and `ADDITIONAL_CHARGE` before offering an action.

The product boundary delegates supported decreasing issuance to the existing verified first/repeated orchestration and supported first-increasing issuance to the serializable schema-version-4 writer. Exact first-increasing retries are re-proved through the existing bounded post-issuance verifier before the idempotent writer is called.

The request body contains only the source invoice number. The browser cannot choose legal direction, money, GST, ordinal, predecessor, provider truth, fingerprint, sequence or issue time. Direction returned to the UI is display-only.

An existing increasing document remains terminal in the reachable product contract. SF does not yet issue a second increase, a decrease after an increase, an increase after a decreasing chain, or cancellation after an amendment.

## Read, accounting, reconciliation, and delivery safety

Authenticated tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public booking-capability reads authorize tenant slug, encrypted capability, persisted ownership, unexpired principal and tenant-owned booking before legal-document history loads.

The shared actor-neutral commercial chain read boundary can now prove referenced schema-version-2 through 5 rows through the complete direction-aware chain. Existing product read/accounting/reconciliation/PDF call sites are intentionally unchanged in this slice: reachable decreasing rows keep using the chain boundary and first-increasing rows keep using the existing first-only verifier. Schema-version-5 product projection therefore remains closed until those surfaces are moved coherently onto the shared authority.

## Next dependency

Add the serializable repeated-increasing writer on top of the locked direction-aware chain head, then move authenticated/public reads, accounting, reconciliation, HTML/PDF delivery, and product orchestration onto the same schema-version-2-through-5 chain authority before exposing a second increasing action.

## Remaining boundary

Repeated-increasing product issuance, broader product-visible mixed-direction chains, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and fail closed until implemented.
