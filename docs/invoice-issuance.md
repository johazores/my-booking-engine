# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so no browser action or mutable customer/pricing record can become legal-document authority by accident.

The implemented customer-facing issuance foundation currently supports the Australian `TAX_INVOICE` contract plus the full-booking-cancellation decreasing-adjustment contract. The persistence foundation is now also ready to represent the first supported commercial-amendment decreasing adjustment without pretending one refund row represents a source-split settlement.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by `organizationId`, `jurisdictionCode`, and `documentType`. Allocation happens in the same serializable transaction as issued-document creation.

`HospitalityIssuedInvoice` stores immutable tax-invoice identity and evidence. It now also exposes `(id, bookingId, organizationId)` uniqueness so downstream legal-document foreign keys can enforce booking scope at the database layer.

`HospitalityIssuedAdjustmentNote` is reason-specific:

- schema version 1 / `BOOKING_CANCELLATION`: one exact `refundTransactionId`, no commercial-amendment/target-evidence authority, ordinal `1`;
- schema version 2 / `COMMERCIAL_AMENDMENT`: no refund transaction, exact `commercialAmendmentId`, exact immutable target pricing-evidence identity, ordinal `1`.

The migration preserves existing cancellation snapshots and numbers unchanged. It adds strict authority checks, one source-invoice/ordinal uniqueness boundary, one commercial-amendment/target-evidence binding, and tenant + booking composite foreign keys to the source invoice, cancellation refund, commercial amendment, and target pricing evidence.

`PaymentTransaction` also exposes `(id, bookingId, organizationId)` uniqueness so a cancellation adjustment cannot reference a same-tenant refund from a different booking.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, then derives sequence, number, issue time, legal snapshot, and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` remains the only enabled adjustment issuance path. It requires `payment:manage`, verifies source invoice, cancellation/refund status, exact successful attributed refund, and immutable money. It now explicitly writes cancellation authority fields and ordinal `1`, and it refuses issuance if any legal adjustment already exists for the source invoice.

Commercial-amendment readiness requires `payment:manage` and already proves source baseline, exact target pricing evidence, standard GST, amendment chronology, and complete provider-neutral settlement. `src/server/payments/hospitality-commercial-amendment-adjustment-note-domain.ts` now defines the immutable schema-version-2 document evidence that future issuance must create.

There is still no commercial-amendment issuance route/button. This prevents a persistence schema change from being misrepresented as a completed legal workflow.

## Read, rendering, PDF, accounting export, retention, reconciliation, and delivery

Authenticated staff tax-document reads require both `booking:read` and `payment:read`. Issuance remains a separate `payment:manage` operation.

The booking workspace, `/invoices/adjustments`, adjustment accounting export, and public booking document history remain connected to the completed cancellation projection only. Their queries explicitly select `BOOKING_CANCELLATION`, and their validators require a non-null refund authority plus the schema-version-1 cancellation snapshot.

This separation is intentional: a schema-version-2 commercial-amendment record must not be rendered as a booking cancellation or silently enter accounting output before its own document validator/projection is implemented.

Tax-invoice behavior, deterministic PDFs, current cancellation PDFs, accounting CSV limits, public capability checks, reconciliation, and retention behavior otherwise remain unchanged. Existing customer-safe outputs still exclude internal IDs, fingerprints, actors, payment/refund/provider references, idempotency keys, credentials, and secrets.

## Commercial-amendment issuance dependency

The previous persistence blocker is complete. The next coherent commercial-amendment issuance slice must:

1. re-enter `payment:manage` and the existing serializable readiness checks at write time;
2. bind the exact source invoice, commercial amendment, and immutable target pricing evidence;
3. keep `refundTransactionId` null and derive legal decrease only from immutable before/after pricing evidence;
4. allocate the shared `AU / ADJUSTMENT_NOTE` number atomically;
5. create and fingerprint the schema-version-2 snapshot;
6. make exact retries idempotent by commercial-amendment authority;
7. fail closed on first-adjustment conflicts or concurrent issuance;
8. audit only safe legal-document metadata; and
9. then expand authenticated/public rendering, deterministic PDF, accounting export, and reconciliation together.

The current `sourceAdjustmentOrdinal = 1` rule explicitly blocks cumulative/multiple adjustments until SF defines how prior legal adjustments change the baseline for a later note.

## Remaining correction boundaries

Partial refunds, multiple/cumulative adjustments, mixed taxability, generic reissue/void workflows, durable re-authenticated customer history, email delivery/resend, universal Unicode-safe PDF rendering, full production-toolchain validation, statutory deadline automation, reviewed disposal/de-identification, and legal review remain separate production work.
