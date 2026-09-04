# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The reachable product supports full booking-cancellation adjustment notes and one or more strictly decreasing commercial-amendment adjustment notes for the same original Australian tax invoice under the narrow AU/AUD standard-GST contract.

## Reachable authority

Reachable issuance currently supports:

- `BOOKING_CANCELLATION`, authorized by one attributed successful full-booking refund transaction; and
- decreasing `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its immutable `COMMERCIAL_AMENDMENT_TARGET` pricing evidence and provider-neutral settlement.

Cancellation documents are schema version 1 / ordinal `1`. First decreasing commercial documents are schema version 2 / ordinal `1`. Repeated decreasing commercial documents are schema version 3 / ordinal `2+` and bind their immediate predecessor.

## Decreasing predecessor chain

A repeated decreasing commercial adjustment is accepted only after the complete source chain is verified. Ordinals must be contiguous, identities/fingerprints unique, chronology non-regressing, every decrease exact AUD standard GST, the first adjustment must begin at the immutable source-invoice price, and each later amendment before-price must equal the preceding adjustment after-price.

Schema version 3 freezes predecessor id/ordinal, document number/time/fingerprint and predecessor after-pricing fingerprint. PostgreSQL independently enforces same-tenant, same-booking, same-source-invoice, same-reason, exact-previous-ordinal and no-fork semantics. `loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` then reloads source invoice, amendments and target-pricing evidence and recomputes all immutable links. A PostgreSQL transaction advisory lock protects chain-head selection for repeated writes.

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` are the reachable decreasing product boundaries. The browser cannot choose ordinal, predecessor, GST, amount, provider truth, fingerprint, sequence or issue time.

## First-increasing server authority

A first `INCREASING / COMMERCIAL_AMENDMENT` authority now has three server layers:

1. `assessHospitalityCommercialAmendmentIncreasingAdjustmentReadiness` revalidates the exact tenant-owned AU/AUD source invoice, one applied `ADDITIONAL_CHARGE` amendment, immutable target pricing, complete provider-neutral settlement and zero prior adjustment notes;
2. schema-version-4 immutable evidence plus mutually exclusive database increase/decrease material columns bind the supported legal effect; and
3. `issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` is a serializable, idempotent server writer that re-runs that evidence boundary, rejects competing opposite/same-direction amendments on the same source baseline, allocates the shared tenant AU adjustment-note sequence, persists zero decrease plus exact positive increase columns, reparses the created snapshot, and records the issuance audit.

This server writer is intentionally not product-reachable yet. Current staff/public read, accounting, reconciliation, HTML and PDF paths still accept cancellation and decreasing commercial documents only and therefore fail closed on schema version 4. The existing API route and primary action do not call the increasing writer.

## Read, accounting, reconciliation, and delivery safety

Authenticated reachable adjustment-note reads require both `booking:read` and `payment:read`; issuance requires `payment:manage`. Public booking-capability reads enforce their independent ownership boundary before legal-document history is loaded.

All reachable decreasing commercial projections prove selected rows are members of the complete verified source chain. Customer-safe projections exclude predecessor ids, internal fingerprints, amendment/target ids, provider/payment references, actors, credentials and secrets unless legally required on the document.

The next dependency for increasing authority is the same shared read proof for schema version 4, followed by accounting/reconciliation and deterministic HTML/PDF projection. Only after those layers are coherent should the route/UI expose server-derived direction-aware issuance.

## Remaining boundary

Cumulative or mixed-direction increasing adjustments, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST rules, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production execution, and jurisdiction/legal review remain separate production work and must fail closed until implemented.
