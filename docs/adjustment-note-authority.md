# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance supports full booking-cancellation decreases, first/repeated strictly decreasing commercial amendments, and the first supported increasing commercial amendment under the narrow AU/AUD fully taxable standard-GST contract.

## Reachable authority

- `DECREASING / BOOKING_CANCELLATION`: one attributed successful full-booking refund, schema version 1 / ordinal `1`.
- first `DECREASING / COMMERCIAL_AMENDMENT`: exact applied `REFUND` amendment plus immutable target pricing and provider-neutral settlement, schema version 2 / ordinal `1`.
- repeated `DECREASING / COMMERCIAL_AMENDMENT`: the same authority plus a complete verified predecessor chain, schema version 3 / ordinal `2+`.
- first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied `ADDITIONAL_CHARGE` amendment plus immutable target pricing and complete settlement, no prior adjustment note, schema version 4 / ordinal `1`.

The original tax invoice is never rewritten.

## Repeated-increasing authority foundation

The readiness domain now models the evidence necessary for a future repeated increase. It requires a complete prior adjustment price chain, exact ordinal continuity, unique document authority, non-regressing chronology, supported standard GST on every prior step, and a candidate before-price equal to the verified chain-head after-price. A prior step may move consideration up or down.

Schema version 5 freezes a repeated increasing document's immediate predecessor id, previous ordinal, document number, issue time, document fingerprint, predecessor after-pricing fingerprint, and exact positive increase effect. PostgreSQL accepts that immutable shape only for an ordinal `2+` `INCREASING / COMMERCIAL_AMENDMENT` row whose material predecessor ordinal is exactly one less.

This is a persistence/readiness foundation, not a reachable writer. The current shared commercial chain verifier and actor-neutral increasing read verifier remain narrower and therefore keep schema-version-5 production issuance closed.

## Direction-aware product boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` is the route/UI authority for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes the source invoice, preserves cancellation priority, derives direction only from persisted commercial amendments, and rejects same-baseline ambiguity across `REFUND` and `ADDITIONAL_CHARGE` before offering an action.

The product boundary delegates supported decreasing issuance to the existing verified first/repeated orchestration and supported first-increasing issuance to the serializable schema-version-4 writer. Exact first-increasing retries are re-proved through the post-issuance verifier before the idempotent writer is called.

The request body contains only the source invoice number. The browser cannot choose legal direction, money, GST, ordinal, predecessor, provider truth, fingerprint, sequence or issue time. Direction returned to the UI is display-only.

An existing increasing document is still terminal in the reachable product contract. SF does not yet issue a second increase, a decrease after an increase, an increase after a decreasing chain, or cancellation after an amendment.

## Read, accounting, reconciliation, and delivery safety

Authenticated tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public booking-capability reads authorize tenant slug, encrypted capability, persisted ownership, unexpired principal and tenant-owned booking before legal-document history loads.

Reachable cancellation, decreasing-commercial and first-increasing-commercial rows continue through their established independent verification paths. No staff/public/accounting/reconciliation/PDF path accepts schema-version-5 evidence yet.

## Next dependency

Extend `loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` and its domain verifier so both directions and schema versions 2 through 5 are proved in one bounded tenant-scoped chain. That shared authority must verify baseline continuity, predecessor identity/fingerprint, exact directional GST effect and payment settlement before a repeated-increasing writer becomes product-reachable.

## Remaining boundary

Repeated-increasing product issuance, broader mixed-direction chains, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and fail closed until implemented.