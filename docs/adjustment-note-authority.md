# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. Reachable issuance currently supports full booking-cancellation adjustment notes and one or more strictly decreasing commercial-amendment adjustment notes under the narrow AU/AUD standard-GST contract. A first increasing commercial-amendment authority now exists through persistence, a serializable writer, independent post-issuance verification, and complete staff/public read-delivery projection, but its writer is not yet product-reachable.

## Reachable decreasing authority

Reachable issuance currently supports:

- `BOOKING_CANCELLATION`, authorized by one attributed successful full-booking refund transaction; and
- decreasing `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its immutable `COMMERCIAL_AMENDMENT_TARGET` pricing evidence and provider-neutral settlement.

Cancellation documents are schema version 1 / ordinal `1`. First decreasing commercial documents are schema version 2 / ordinal `1`. Repeated decreasing commercial documents are schema version 3 / ordinal `2+` and bind their immediate predecessor.

## Decreasing predecessor chain

A repeated decreasing commercial adjustment is accepted only after the complete source chain is verified. Ordinals must be contiguous, identities/fingerprints unique, chronology non-regressing, every decrease exact AUD standard GST, the first adjustment must begin at the immutable source-invoice price, and each later amendment before-price must equal the preceding adjustment after-price.

Schema version 3 freezes predecessor id/ordinal, document number/time/fingerprint and predecessor after-pricing fingerprint. PostgreSQL independently enforces same-tenant, same-booking, same-source-invoice, same-reason, exact-previous-ordinal and no-fork semantics. `loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` then reloads source invoice, amendments and target-pricing evidence and recomputes all immutable links. A PostgreSQL transaction advisory lock protects chain-head selection for repeated writes.

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` are the reachable decreasing product boundaries. The browser cannot choose ordinal, predecessor, GST, amount, provider truth, fingerprint, sequence or issue time.

## First-increasing server authority

A first `INCREASING / COMMERCIAL_AMENDMENT` authority has four server layers:

1. `assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` revalidates the exact tenant-owned AU/AUD source invoice, one applied `ADDITIONAL_CHARGE` amendment, immutable target pricing, complete provider-neutral settlement and zero prior adjustment notes;
2. schema-version-4 immutable evidence plus mutually exclusive database increase/decrease material columns bind the supported legal effect;
3. `issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is a serializable, idempotent server writer that re-runs that evidence boundary, rejects competing opposite/same-direction amendments on the same source baseline, allocates the shared tenant AU adjustment-note sequence, persists zero decrease plus exact positive increase columns, reparses the created snapshot, and records the issuance audit; and
4. `verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows` independently re-proves post-issuance source invoice, applied amendment, unique target pricing, complete booking payment ledger, sole source-adjustment authority, source-baseline uniqueness, chronology, material effect and fingerprints under tenant scope.

The writer remains intentionally not product-reachable. The existing commercial-amendment API route and primary action do not call it yet.

## Read, accounting, reconciliation, and delivery safety

Authenticated adjustment-note reads require both `booking:read` and `payment:read`; issuance requires `payment:manage`. Public booking-capability reads enforce tenant slug, encrypted booking capability, persisted ownership, unexpired principal and tenant-owned booking before legal-document history is loaded.

Cancellation, decreasing-commercial and first-increasing-commercial rows are classified separately. Decreasing commercial projections prove selected rows are members of the complete verified source chain. First-increasing rows pass the bounded actor-neutral verifier before they can enter staff detail/register, accounting, reconciliation, public history or PDF delivery.

Customer-safe projections exclude predecessor ids, internal fingerprints, amendment/target ids, provider/payment references, actors, credentials and secrets unless legally required on the document. Register/detail/public UI and the deterministic PDF renderer derive labels and money from the verified adjustment direction rather than assuming every adjustment is decreasing. Accounting export carries an explicit adjustment type and separate increase/decrease columns.

## Next dependency

The next coherent increasing dependency is direction-aware issuance orchestration in the existing commercial-amendment product action/API. Availability must be server-derived, and the product may call the first-increasing writer only after the same immutable authority is revalidated in the serializable write. The browser must never choose the legal direction, amount, GST, ordinal, sequence, issue time, source authority or provider truth.

## Remaining boundary

Cumulative or mixed-direction increasing adjustments, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST rules, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and must fail closed until implemented.
