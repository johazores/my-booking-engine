# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance supports full booking-cancellation decreases, direction-aware cumulative commercial amendments, and one terminal cancellation after a verified commercial-amendment chain under the narrow AU/AUD fully taxable standard-GST contract.

## Reachable authority

- `DECREASING / BOOKING_CANCELLATION`, ordinal `1`, schema version 1: one attributed successful full-booking refund against an unadjusted source invoice.
- first `DECREASING / COMMERCIAL_AMENDMENT`, ordinal `1`, schema version 2: exact applied `REFUND` amendment + immutable target pricing + provider-neutral settlement.
- repeated `DECREASING / COMMERCIAL_AMENDMENT`, ordinal `2+`, schema version 3: the same authority plus a complete verified predecessor chain; the predecessor may be decreasing or increasing.
- first `INCREASING / COMMERCIAL_AMENDMENT`, ordinal `1`, schema version 4: exact applied `ADDITIONAL_CHARGE` amendment + immutable target pricing + complete settlement.
- repeated `INCREASING / COMMERCIAL_AMENDMENT`, ordinal `2+`, schema version 5: one unique applied `ADDITIONAL_CHARGE` from the verified current legal chain head + immutable target pricing + complete settlement + predecessor authority.
- terminal `DECREASING / BOOKING_CANCELLATION`, ordinal `2+`, schema version 6: a verified commercial chain head reduced to zero by a bounded exact set of successful source-attributed non-commercial refunds.

The original tax invoice is never rewritten.

## Direction-aware commercial chain authority

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` and its domain verifier understand the complete commercial legal chain across schema versions 2 through 5 and both supported directions.

Every chain load is tenant-, booking-, and source-invoice-scoped. It independently reloads and validates the immutable source tax invoice, referenced applied amendments, immutable target-pricing evidence, document fingerprints/material columns, contiguous ordinals, predecessor identity/fingerprint continuity, issuer/recipient continuity, chronology, and exact standard-GST direction/effect.

Payment settlement is re-proved stepwise from a progressive provider-neutral ledger restricted to transactions that existed no later than each legal document issue time. Earlier legal steps therefore retain their historical settlement proof after later amendments are issued.

Rows fail closed on unsupported direction/schema combinations, gaps, forks, duplicate authority, cross-tenant/source evidence, baseline drift, target-pricing drift, non-standard GST, unresolved/conflicting settlement, or an incorrect net settled amount.

Repeated commercial writes select the verified chain head under the tenant/booking/source PostgreSQL transaction advisory lock.

## Terminal cancellation authority

Cancellation after commercial amendments is not treated as another commercial chain member. Historical commercial reads may tolerate exactly one structurally terminal `BOOKING_CANCELLATION` row so earlier commercial documents remain independently verifiable, while the locked commercial write path remains strict and refuses any non-commercial row.

Schema version 6 binds the terminal cancellation to the exact commercial chain head: predecessor ID/ordinal/document number/time/fingerprint, predecessor after-pricing fingerprint, before pricing/GST/total, zero after pricing, exact decrease, issuer/recipient/source fingerprints, and an ordered refund-authority set of at most 256 successful transactions.

`hospitality-cancellation-after-amendment-adjustment-authority-service.ts` reloads the tenant-scoped commercial chain, source invoice, booking, and payment ledger, reconstructs payment truth only through the cancellation document issue time, re-runs cancellation readiness, and verifies every frozen refund ID/ordinal/amount/timestamp and legal effect. A drifted or incomplete document fails closed.

`issueHospitalityCancellationAfterAmendmentAdjustmentNote` re-runs that authority under the serialized source-chain lock, allocates the shared AU adjustment-note sequence, persists canonical schema-version-6 evidence, immediately verifies the created row inside the transaction, retries supported write races, and audits issuance without storing individual refund IDs in the audit payload.

## Product boundary

`hospitality-commercial-amendment-adjustment-product-service.ts` remains the route/UI authority for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes source authority, derives direction from persisted amendments, verifies existing commercial history, and rejects same-baseline ambiguity.

`getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability` is the terminal cancellation availability boundary. It requires `payment:manage`, proves the complete current commercial chain, re-derives the refund set and zero settlement, and independently verifies any already-issued schema-version-6 document before exposing it.

The tax-invoice UI gives a supported terminal cancellation priority over a new commercial adjustment. For schema version 6, the browser request contains only the source invoice number. Refund IDs, legal direction, GST, money, ordinal, predecessor, provider truth, sequence, fingerprint, and issue time are server authority.

## Read, accounting, reconciliation, and delivery safety

Authenticated tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public booking-capability reads authorize tenant slug, encrypted capability, persisted ownership, unexpired principal, and the tenant-owned booking before legal-document history loads.

`hospitality-issued-adjustment-note-authority-service.ts` is the shared actor-neutral evidence boundary. Legacy schema-version-1 cancellation keeps its immutable source invoice + attributed full-refund authority, schema-version-6 cancellation uses the terminal-chain/refund-set verifier, and commercial schema-version-2-through-5 rows use the complete commercial chain verifier.

Authenticated detail/register/accounting reads and public capability history use the same boundary. Reconciliation inherits it through the staff register service, and authenticated/public HTML and deterministic PDF delivery inherit it through verified document reads. Customer-safe projections omit internal predecessor/amendment/target IDs, fingerprints, actors, and provider/payment/refund references unless legally required.

## Remaining boundary

Mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and fail closed until implemented.
