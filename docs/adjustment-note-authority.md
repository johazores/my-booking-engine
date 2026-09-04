# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance supports full booking-cancellation decreases, first/repeated strictly decreasing commercial amendments, and the first supported increasing commercial amendment under the narrow AU/AUD fully taxable standard-GST contract.

## Reachable authority

- `DECREASING / BOOKING_CANCELLATION`: one attributed successful full-booking refund, schema version 1 / ordinal `1`.
- first `DECREASING / COMMERCIAL_AMENDMENT`: exact applied `REFUND` amendment plus immutable target pricing and provider-neutral settlement, schema version 2 / ordinal `1`.
- repeated `DECREASING / COMMERCIAL_AMENDMENT`: the same authority plus a complete verified predecessor chain, schema version 3 / ordinal `2+`.
- first `INCREASING / COMMERCIAL_AMENDMENT`: exact applied `ADDITIONAL_CHARGE` amendment plus immutable target pricing and complete settlement, no prior adjustment note, schema version 4 / ordinal `1`.

The original tax invoice is never rewritten.

## Decreasing predecessor chain

Repeated decreasing commercial adjustments are accepted only after complete source-chain verification. Ordinals must be contiguous, identities and fingerprints unique, chronology non-regressing, every decrease exact standard GST, the first adjustment must begin at the immutable source-invoice price, and each later amendment before-price must equal the preceding adjustment after-price.

PostgreSQL binds repeated predecessors to the same tenant, booking, source invoice, reason and exact prior ordinal. Unique predecessor authority prevents forks. `loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` independently reloads the source invoice, amendments and exact target-pricing evidence and recomputes every immutable link. Repeated writes select the verified chain head under a PostgreSQL transaction advisory lock.

## First-increasing authority

The first-increasing contract has four independent layers:

1. readiness revalidates the tenant-owned AU/AUD source invoice, exact applied `ADDITIONAL_CHARGE` amendment, unique immutable target pricing, complete provider-neutral settlement and zero prior adjustment notes;
2. schema-version-4 snapshot and material columns freeze a mutually exclusive positive increase effect;
3. `issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` performs the serializable idempotent legal write, rejects same-source-baseline competing applied amendments, allocates the shared tenant sequence and records the audit; and
4. `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows` independently re-proves the complete post-issuance authority before staff/public/accounting/reconciliation/PDF projection.

## Direction-aware product boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` is now the route/UI authority for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes the source invoice, preserves cancellation priority, derives direction only from persisted commercial amendments, and rejects same-baseline ambiguity across `REFUND` and `ADDITIONAL_CHARGE` before offering an action.

The product boundary delegates supported decreasing issuance to the existing verified first/repeated orchestration and supported first-increasing issuance to the existing serializable increasing writer. Exact increasing retries are re-proved through the post-issuance verifier before the idempotent writer is called.

The request body contains only the source invoice number. The browser cannot choose legal direction, money, GST, ordinal, predecessor, provider truth, fingerprint, sequence or issue time. Direction returned to the UI is display-only.

An existing increasing document is terminal for the currently supported first-increasing contract. SF does not infer a second increase, a decrease after an increase, an increase after a decreasing chain, or cancellation after an amendment.

## Read, accounting, reconciliation, and delivery safety

Authenticated tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public booking-capability reads authorize tenant slug, encrypted capability, persisted ownership, unexpired principal and tenant-owned booking before legal-document history loads.

Cancellation, decreasing-commercial and first-increasing-commercial rows are classified separately. Decreasing commercial rows must pass complete chain verification. First-increasing rows must pass the bounded actor-neutral increasing verifier. Customer-safe projections exclude internal predecessor/amendment/target ids, fingerprints, actors and provider/payment references unless legally required.

Register/detail/public UI, accounting export and deterministic PDF projection are direction-aware and do not represent an increase as a credit/decrease.

## Remaining boundary

Cumulative or mixed-direction increasing adjustments, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and fail closed until implemented.
