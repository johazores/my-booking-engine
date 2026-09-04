# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The current persistence model supports two decreasing-adjustment authorities while deliberately keeping the single-adjustment-per-source-invoice boundary explicit.

## Current authority model

`HospitalityIssuedAdjustmentNote` supports:

- `BOOKING_CANCELLATION`, authorized by exactly one attributed successful full-booking refund transaction; and
- `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record. It does not persist one synthetic refund transaction as legal authority because amendment settlement can span multiple payment sources.

The row carries `sourceAdjustmentOrdinal`, but the current PostgreSQL contract fixes it to `1`. The unique `(organizationId, sourceInvoiceId, sourceAdjustmentOrdinal)` constraint therefore preserves one legal adjustment against a source tax invoice until cumulative/multiple-adjustment semantics are designed and reviewed.

There is no predecessor-adjustment column and there are no separate persisted before/after money columns. Commercial before/after standard-GST totals and pricing fingerprints live inside the schema-version-2 immutable document snapshot and are reconciled to the material decrease columns by database checks and server validation.

Composite foreign keys keep the source invoice, refund transaction where applicable, commercial amendment, and target pricing evidence inside the same booking and tenant. Database checks also enforce the supported reason/authority exclusivity, AUD/AU document contract, snapshot/material-column agreement, ordinal `1`, and schema-version-specific legal evidence shape.

## Snapshot compatibility

Existing cancellation documents remain schema version 1 and are not rewritten. Their `refundTransactionId`, immutable JSON, and document fingerprints remain authoritative.

Commercial-amendment documents use schema version 2. They freeze source-invoice identity and chronology, commercial-amendment identity and applied timestamp, target pricing-evidence identity, ordinal `1`, exact before/after GST and total amounts, exact decrease, source/pricing/party fingerprints, seller and buyer evidence, supplier ABN, and Australian legal labels. They contain no `refundTransactionId`.

## Issuance

Booking-cancellation issuance remains available under its existing `payment:manage`, serializable transaction, full-refund attribution, source-invoice integrity, idempotency, sequence, and audit requirements.

Commercial-amendment issuance is also server-authoritative. It requires `payment:manage`, re-runs the complete commercial-amendment readiness contract in a serializable transaction, requires exactly one immutable target pricing-evidence record, proves provider-neutral settlement from the complete tenant-scoped booking payment ledger, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates the schema-version-2 snapshot and fingerprint, persists amendment/target authority without a synthetic refund id, writes a safe audit event, and is idempotent by commercial-amendment authority.

The supported commercial contract is intentionally narrow: one applied `REFUND` amendment against the original immutable tax-invoice baseline, standard GST before and after, one legal adjustment only, and fully reconciled settlement. Partial, repeated, cumulative, increasing, mixed-taxability, and predecessor-chain semantics remain unsupported.

## Read integrity

Authenticated adjustment-note detail, register, accounting export, and reconciliation reads require both `booking:read` and `payment:read`. They validate the row/snapshot/document fingerprint, revalidate the complete immutable source tax invoice, and then validate the authority specific to the adjustment reason:

- cancellation reads revalidate the attributed successful full refund; and
- commercial-amendment reads revalidate the applied amendment plus exact target pricing-evidence row and parsed pricing breakdown against the immutable source baseline and schema-version-2 snapshot.

Unknown reasons, cross-tenant links, material-column drift, source-invoice drift, stale amendment evidence, malformed target pricing evidence, or broken authority fail closed.

The authenticated HTML renderer and accounting/reconciliation projections support both current authority forms. The deterministic adjustment-note PDF and public booking-capability document projection remain cancellation-only until their commercial-amendment validation/rendering paths are completed; the UI does not present those unavailable outputs as working.

## Validation status

The commercial snapshot domain and shared legal-document projection have dependency-free tests, and changed TypeScript/TSX surfaces are syntax-checked where the current environment permits. Full Node 24 repository validation, Prisma migration verification, PostgreSQL concurrency/integration tests, and jurisdiction/legal review remain required before production enablement is treated as complete.
