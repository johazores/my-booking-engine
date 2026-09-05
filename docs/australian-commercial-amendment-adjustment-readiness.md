# Australian commercial-amendment adjustment readiness

## Purpose

SF has server-side readiness, issuance, read, PDF, accounting, reconciliation and public-delivery contracts for first and repeated Australian hospitality commercial-amendment decreasing adjustments. Repeated documents use the same immutable source invoice and a verified linear predecessor chain; no browser/provider response can invent the legal baseline.

The product shares a direction-aware commercial-adjustment boundary with supported increasing adjustments while the decreasing readiness/chain contract remains independently fail closed.

## Authority

Readiness and issuance require `payment:manage`. Authenticated legal-document reads require `booking:read` plus `payment:read`. Legal authority is derived from persisted tenant-scoped evidence. Browser input never supplies GST, amounts, currency, provider truth, direction, pricing fingerprints, sequence, issue time, source ordinal or predecessor authority.

## Decreasing readiness contract

`assessAustralianCommercialAmendmentAdjustmentReadiness` accepts only AU/AUD fully taxable standard-GST decreasing `REFUND` amendments that are already `APPLIED` and whose provider-neutral settlement reconciles exactly to the applied after-total.

For the first adjustment, the amendment before-price must exactly equal the immutable source tax invoice and the after-price must equal exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record.

For a later decreasing adjustment, the complete verified predecessor set must be contiguous, unique, chronologically monotonic, standard-GST decreasing and price-continuous from the source invoice through the new amendment before-price. A valid result returns the exact next source ordinal and immediate predecessor identity.

A later decrease is intentionally not offered once an increasing commercial adjustment exists. Decrease-after-increase semantics require a separate reviewed lifecycle contract.

## Persisted and verified chain

`HospitalityIssuedAdjustmentNote` carries predecessor id/ordinal for ordinal `2+` commercial documents. PostgreSQL enforces same-tenant/same-booking/same-source/same-reason predecessor authority, contiguous ordinals, no forks and no self-predecessor.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reparses/fingerprints every persisted row and reloads the source invoice, every applied amendment and exact target-pricing record under tenant + booking scope. It verifies schema versions 2 through 5 across supported decreasing/increasing steps. Mixed cancellation/commercial evidence fails closed. The chain limit is 5,000 documents. Repeated writes use a transaction advisory lock keyed by tenant + booking + source invoice before reloading the head.

## Product availability and issuance

The decreasing orchestration derives the current legal baseline, searches only applied `REFUND` amendments beginning at that baseline, requires one exact target-pricing row, derives settlement from the complete booking ledger and re-runs cumulative readiness. Returned ordinal/predecessor authority is server-derived.

The shared `hospitality-commercial-amendment-adjustment-product-service.ts` wraps that decreasing orchestration without weakening it. While no increasing history exists, decreasing availability keeps priority. When decreasing availability succeeds, the product boundary verifies the selected persisted candidate still has `REFUND` direction and checks for another applied refund/additional-charge amendment sharing that baseline before exposing the action. It returns `adjustmentType = DECREASING` only as server-derived display/orchestration data.

If a verified commercial chain has no supported next decrease, the same product boundary can select a repeated increasing `ADDITIONAL_CHARGE` against the verified chain head through the increasing readiness contract. This supports decrease-to-increase without making decrease-after-increase reachable.

`issueHospitalityNextCommercialAmendmentAdjustmentNote` requires the requested route amendment id to equal the unique server-derived candidate. Decreasing writes delegate to the existing first/repeated writer selection; exact retries prove the existing document belongs to the complete source chain.

The route request body contains only `sourceInvoiceDocumentNumber`. Browser input cannot select writer, direction, ordinal or predecessor.

## Read and delivery convergence

Staff detail/register/accounting/reconciliation reads and public capability history accept commercial schema-version-2-through-5 documents only through the shared complete chain authority. Public ownership is verified before chain loading, and customer-safe projections omit internal predecessor/amendment/target authority.

Authenticated/public HTML and deterministic PDF routes reuse those verified read boundaries.

## Remaining boundaries

Increasing issuance is documented separately in `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`. Decrease-after-increase, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/Prisma/PostgreSQL execution and jurisdiction/legal review remain separate contracts.
