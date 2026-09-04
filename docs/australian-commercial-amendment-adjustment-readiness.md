# Australian commercial-amendment adjustment readiness

## Purpose

SF has a server-side readiness, issuance, read, PDF, and public-delivery contract for the first Australian hospitality **commercial-amendment decreasing adjustment**. The contract remains intentionally narrow so legal-document behavior cannot outrun the immutable evidence model.

The readiness domain also defines the cumulative legal-baseline contract for a second or later decreasing commercial amendment. Persistence can now represent a linear predecessor chain, but repeated issuance remains deliberately unreachable until service/read validation consumes that chain end to end.

## Authority

Readiness and issuance require `payment:manage`.

Inside tenant- and booking-scoped transactions SF verifies the AU/AUD source tax invoice, exact applied commercial amendment, immutable target pricing evidence, provider-neutral settlement, exact standard-GST money, and legal chronology. Browser input never supplies GST, money, currency, provider truth, settlement source, amendment direction, pricing fingerprints, sequence, or predecessor authority.

## First decreasing-adjustment contract

The currently issued first adjustment succeeds only when:

1. the source invoice is AU/AUD and its immutable price components reconcile;
2. the amendment is `APPLIED`, direction `REFUND`, and does not predate the source invoice;
3. source-invoice money/fingerprint exactly match the amendment frozen before price;
4. the amendment frozen after price exactly matches one immutable target pricing-evidence row;
5. there is no earlier issued adjustment against that source invoice;
6. before/after prices are fully taxable standard-GST evidence;
7. the positive decrease, signed amendment delta, subtotal, GST, and total reconcile exactly; and
8. amendment-owned settlement is fully reconciled with nothing remaining and net booking settlement equal to the applied after-total.

Issuance also refuses an applied timestamp in the future relative to the legal document issue time.

## Cumulative readiness contract

For a second or later commercial decrease, the domain requires the complete verified predecessor set. It rejects missing evidence, count/ordinal gaps, duplicate predecessor identities/fingerprints, chronology regressions, non-standard-GST decreases, source-to-chain price drift, predecessor-to-predecessor price drift, next-amendment baseline drift, and a new amendment applied before its immediate predecessor adjustment note.

A valid assessment returns the exact next `sourceAdjustmentOrdinal` plus the immediate predecessor adjustment-note id, document number, document fingerprint, and issue-time boundary required to create schema-version-3 evidence.

The current issuance service still passes only the prior-document count, not the verified predecessor documents, so the existing first-adjustment-only product behavior remains fail closed.

## Provider-neutral settlement versus legal authority

Payment settlement proves money movement; it does not establish the legal tax-document baseline. A commercial-amendment refund can span multiple settlement sources, so SF reconciles `PaymentTransaction.commercialAmendmentId` through the provider-neutral settlement domain rather than selecting one synthetic refund row.

The persisted legal authority is the applied commercial amendment plus its immutable target pricing evidence. Repeated legal authority additionally requires the immediate predecessor adjustment note and the complete verified chain leading to it.

## Persistence contract

`HospitalityIssuedAdjustmentNote` can represent cancellation authority or commercial-amendment authority. The model now also carries nullable `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal` fields for cumulative commercial adjustments.

The cumulative-chain migration preserves existing ordinal-1 rows and enforces:

- one `(organization, source invoice, ordinal)` row;
- one successor for any predecessor;
- an immediate predecessor foreign key bound to the same booking, tenant, source invoice, adjustment reason, and predecessor ordinal;
- contiguous ordinals with no self-predecessor;
- ordinal-1 cancellation/schema-version-1 authority unchanged;
- ordinal-1 commercial/schema-version-2 authority unchanged; and
- ordinal-2+ commercial rows only with predecessor authority and schema-version-3 snapshot agreement.

Schema version 3 binds the predecessor id/document identity/fingerprint evidence inside the immutable canonical snapshot. The database binds the persisted predecessor id and chain topology; future service/read work must additionally prove the referenced predecessor snapshot values themselves match those frozen schema-version-3 fields before repeated issuance or delivery is enabled.

## Current issuance workflow

`issueHospitalityCommercialAmendmentAdjustmentNote` remains first-adjustment-only. It re-enters `payment:manage`, re-runs complete readiness in a serializable transaction, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates/fingerprints schema-version-2 evidence, persists exact amendment/target authority, writes a safe audit event, and is idempotent by tenant + commercial amendment.

The authenticated tax-invoice page continues to expose the commercial issuance action only when one unambiguous first amendment is ready. No repeated-adjustment action is exposed merely because the database can now represent a chain.

## Read and downstream status

Authenticated adjustment-note detail/register, accounting CSV, reconciliation, deterministic PDF, and public booking-capability history currently support the two ordinal-1 reasons only. They revalidate the immutable source invoice and current reason-specific authority server-side.

Repeated schema-version-3 rows must continue to fail closed in these readers until they validate the immediate predecessor and complete source chain. This avoids a migration-only change accidentally becoming a customer-visible legal-document workflow.

## Remaining boundary

The next coherent production slice is the server-side repeated-issuance/read path: load and independently validate the complete persisted predecessor chain in the serializable issuance boundary, create schema-version-3 documents from the verified chain head, then extend authenticated/public reads, accounting, reconciliation, HTML, and PDF delivery with the same chain validation.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/PostgreSQL validation, and jurisdiction/legal review remain separate boundaries.

ATO guidance treats a change in consideration as an adjustment event. SF keeps this contract narrow and does not treat the code or this document as legal advice; jurisdiction/legal review remains required before broader commercial-amendment adjustment-note operations are treated as production complete.
