# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The current production persistence and issuance path supports two decreasing-adjustment authorities while deliberately keeping the single-issued-adjustment-per-source-invoice boundary explicit.

## Current issued authority model

`HospitalityIssuedAdjustmentNote` currently supports:

- `BOOKING_CANCELLATION`, authorized by exactly one attributed successful full-booking refund transaction; and
- `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record. It does not persist one synthetic refund transaction as legal authority because amendment settlement can span multiple payment sources.

The persisted row carries `sourceAdjustmentOrdinal`, but the current PostgreSQL contract still fixes it to `1`. The unique `(organizationId, sourceInvoiceId, sourceAdjustmentOrdinal)` constraint therefore preserves one issued legal adjustment against a source tax invoice until the predecessor relation and cumulative database invariants are migrated.

There is still no predecessor-adjustment column and there are no separate persisted before/after money columns. Commercial before/after standard-GST totals and pricing fingerprints live inside the immutable document snapshot and are reconciled to the material decrease columns by database checks and server validation.

Composite foreign keys keep the source invoice, refund transaction where applicable, commercial amendment, and target pricing evidence inside the same booking and tenant. Database checks enforce the currently issued reason/authority exclusivity, AUD/AU document contract, schema-version-specific legal evidence shape, material decrease/fingerprint agreement, and ordinal `1`.

## Cumulative commercial-amendment domain contract

The commercial-amendment readiness domain now defines the fail-closed legal-baseline contract needed before repeated decreasing adjustments can be persisted:

- the complete predecessor adjustment set must be supplied when earlier legal adjustments exist;
- source ordinals must start at `1` and remain contiguous;
- predecessor adjustment ids, document numbers, and document fingerprints must be non-empty, unique, and immutable;
- issue chronology cannot move backwards from the source tax invoice through the predecessor chain;
- the first predecessor before-price must exactly equal the immutable source tax-invoice price;
- every later predecessor before-price must exactly equal the previous predecessor after-price;
- every predecessor must be one exact AUD, fully taxable standard-GST decrease;
- the next amendment before-price must exactly equal the last verified predecessor after-price; and
- the next applied amendment cannot predate the predecessor adjustment note that establishes that legal baseline.

A valid assessment returns the expected next `sourceAdjustmentOrdinal` plus the immediate predecessor adjustment id, document number, and document fingerprint. The current issuance service does **not** supply predecessor-chain evidence yet, so any source invoice with an existing adjustment still fails closed and no repeated document is issued.

## Immutable snapshot compatibility

Existing cancellation documents remain schema version 1 and are not rewritten. Their `refundTransactionId`, immutable JSON, and document fingerprints remain authoritative.

First commercial-amendment documents remain schema version 2. They freeze source-invoice identity and chronology, commercial-amendment identity and applied timestamp, target pricing-evidence identity, ordinal `1`, exact before/after GST and total amounts, exact decrease, source/pricing/party fingerprints, seller and buyer evidence, supplier ABN, and Australian legal labels. They contain no `refundTransactionId`.

The commercial snapshot domain now also defines schema version 3 for a future repeated commercial-amendment document. Schema version 3 preserves all schema-version-2 evidence and additionally binds:

- a source ordinal of `2` or greater;
- the immediate predecessor adjustment-note id;
- predecessor adjustment-note document number and issue timestamp;
- predecessor document fingerprint; and
- predecessor after-pricing fingerprint, which must exactly equal the new document before-pricing fingerprint.

The parser rejects hidden predecessor fields on schema version 2, ordinal gaps, missing predecessor authority, predecessor chronology drift, self-predecessor document numbers, malformed fingerprints, and predecessor/before-price fingerprint mismatch. Predecessor evidence participates in the canonical document fingerprint.

Schema version 3 is a domain contract only in the current repository state. The Prisma model, PostgreSQL checks/foreign keys, issuance service, authenticated/public read validators, accounting export, reconciliation, HTML document delivery, and PDF delivery continue to accept issued ordinal-1 documents only. No route or UI action can issue a schema-version-3 document yet.

## Current issuance

Booking-cancellation issuance remains available under its existing `payment:manage`, serializable transaction, full-refund attribution, source-invoice integrity, idempotency, sequence, and audit requirements.

First commercial-amendment issuance remains server-authoritative. It requires `payment:manage`, re-runs the complete commercial-amendment readiness contract in a serializable transaction, requires exactly one immutable target pricing-evidence record, proves provider-neutral settlement from the complete tenant-scoped booking payment ledger, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates the schema-version-2 snapshot and fingerprint, persists amendment/target authority without a synthetic refund id, writes a safe audit event, and is idempotent by commercial-amendment authority.

The currently issued commercial contract remains intentionally narrow: one applied `REFUND` amendment against the original immutable tax-invoice baseline, standard GST before and after, one issued legal adjustment only, and fully reconciled settlement.

## Read integrity

Authenticated adjustment-note detail, register, accounting export, and reconciliation reads require both `booking:read` and `payment:read`. They validate the row/snapshot/document fingerprint, revalidate the complete immutable source tax invoice, and then validate the authority specific to the adjustment reason:

- cancellation reads revalidate the attributed successful full refund; and
- commercial-amendment reads revalidate the applied amendment plus exact target pricing-evidence row and parsed pricing breakdown against the currently supported immutable source baseline and schema-version-2 snapshot.

Public booking-capability reads enforce an independent customer authorization boundary first, then apply the same reason-specific legal evidence checks. Revoked or expired public principals are rejected before legal-document history is loaded.

Unknown reasons, cross-tenant links, material-column drift, source-invoice drift, stale amendment evidence, malformed target pricing evidence, unsupported schema-version-3 persistence, or broken authority fail closed.

## Next persistence dependency

Repeated/cumulative issuance must not be enabled until the database and service boundary can enforce the same chain contract independently. The next coherent migration needs an immediate-predecessor relation constrained to the same organization, booking, and original source invoice; no-fork/one-successor protection; contiguous source ordinals; schema-version-3 snapshot/database agreement; serializable chain-head selection; and reason-specific read/reconciliation validation before any repeated issuance action becomes reachable.

Partial adjustments, increasing adjustments, mixed taxability, cancellation-after-amendment semantics, generic correction/void/reissue, and other jurisdictions remain separate contracts.

## Validation status

The commercial readiness suite now covers first, second, and third decreasing-adjustment baseline assessment plus count, ordinal, chronology, identity, tax, target, and settlement failures. The immutable commercial snapshot suite covers schema-version-2 compatibility and schema-version-3 predecessor binding/round-trip/fail-closed behavior. Full Node 24 repository validation, Prisma migration verification, PostgreSQL concurrency/integration tests, universal Unicode-safe PDF support, and jurisdiction/legal review remain required before the broader lifecycle is treated as production complete.
