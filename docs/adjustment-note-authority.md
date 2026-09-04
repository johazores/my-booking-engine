# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The current production issuance path supports two decreasing-adjustment authorities at source ordinal `1`. The persistence layer now also has a fail-closed linear predecessor-chain shape for future repeated commercial-amendment adjustments, but repeated issuance and delivery remain unreachable.

## Current issued authority model

`HospitalityIssuedAdjustmentNote` currently issues:

- `BOOKING_CANCELLATION`, authorized by exactly one attributed successful full-booking refund transaction; and
- `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record. It does not persist one synthetic refund transaction as legal authority because amendment settlement can span multiple payment sources.

Existing cancellation documents remain schema version 1 and ordinal `1`. Existing/first commercial-amendment documents remain schema version 2 and ordinal `1`. Commercial before/after standard-GST totals and pricing fingerprints live inside the immutable document snapshot and reconcile to material decrease columns through database checks and server validation.

Composite foreign keys keep the source invoice, refund transaction where applicable, commercial amendment, and target pricing evidence inside the same booking and tenant. The current issuance/read services continue to reject unsupported repeated persistence, so adding the chain shape does not silently broaden legal-document behavior.

## Cumulative commercial-amendment domain contract

The commercial-amendment readiness domain defines the fail-closed legal-baseline contract for a second or later decreasing adjustment:

- the complete predecessor adjustment set must be supplied when earlier legal adjustments exist;
- source ordinals must start at `1` and remain contiguous;
- predecessor adjustment ids, document numbers, and document fingerprints must be non-empty, unique, and immutable;
- issue chronology cannot move backwards from the source tax invoice through the predecessor chain;
- the first predecessor before-price must exactly equal the immutable source tax-invoice price;
- every later predecessor before-price must exactly equal the previous predecessor after-price;
- every predecessor must be one exact AUD, fully taxable standard-GST decrease;
- the next amendment before-price must exactly equal the last verified predecessor after-price; and
- the next applied amendment cannot predate the predecessor adjustment note that establishes that legal baseline.

A valid assessment returns the expected next `sourceAdjustmentOrdinal` plus immediate predecessor identity. The current issuance service does **not** load/supply predecessor-chain evidence yet, so any source invoice with an existing adjustment still fails closed and no repeated document is issued.

## Immutable snapshot compatibility

Cancellation documents remain schema version 1 and are never rewritten. Their `refundTransactionId`, immutable JSON, and document fingerprints remain authoritative.

First commercial-amendment documents remain schema version 2. They freeze source-invoice identity and chronology, commercial-amendment identity and applied timestamp, target pricing-evidence identity, ordinal `1`, exact before/after GST and total amounts, exact decrease, source/pricing/party fingerprints, seller and buyer evidence, supplier ABN, and Australian legal labels. They contain no `refundTransactionId`.

Schema version 3 is defined for a repeated commercial-amendment document and preserves all schema-version-2 evidence while additionally binding:

- source ordinal `2` or greater;
- immediate predecessor adjustment-note id;
- predecessor document number and issue timestamp;
- predecessor document fingerprint; and
- predecessor after-pricing fingerprint, which must exactly equal the new document before-pricing fingerprint.

The parser rejects hidden predecessor fields on schema version 2, ordinal gaps, missing predecessor authority, predecessor chronology drift, self-predecessor document numbers, malformed fingerprints, and predecessor/before-price fingerprint mismatch. Predecessor evidence participates in the canonical document fingerprint.

## Persisted predecessor-chain contract

The Prisma/PostgreSQL persistence model now includes nullable `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal` authority for future ordinal `2+` commercial documents.

The database independently enforces the structural chain:

- the predecessor foreign key binds the previous document to the same organization, booking, original source invoice, adjustment reason, and exact previous ordinal;
- `predecessorSourceAdjustmentOrdinal = sourceAdjustmentOrdinal - 1` prevents ordinal gaps;
- unique predecessor authority prevents two successor documents from forking from the same chain head;
- a row cannot identify itself as predecessor;
- cancellation stays schema version 1 / ordinal `1` with no predecessor;
- first commercial adjustment stays schema version 2 / ordinal `1` with no predecessor; and
- repeated commercial rows require schema version 3 plus persisted predecessor identity and the existing standard-GST/decrease checks.

The database intentionally does not claim to validate all referenced predecessor snapshot content. Before repeated issuance/read support becomes reachable, the server must load the complete predecessor chain and revalidate each referenced document number, issue timestamp, document fingerprint, after-pricing fingerprint, commercial authority, chronology, and price continuity against immutable evidence.

## Current issuance

Booking-cancellation issuance remains available under its existing `payment:manage`, serializable transaction, full-refund attribution, source-invoice integrity, idempotency, sequence, and audit requirements.

First commercial-amendment issuance remains server-authoritative. It requires `payment:manage`, re-runs the complete first-adjustment readiness contract in a serializable transaction, requires exactly one immutable target pricing-evidence record, proves provider-neutral settlement from the complete tenant-scoped booking payment ledger, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates the schema-version-2 snapshot and fingerprint, persists amendment/target authority without a synthetic refund id, writes a safe audit event, and is idempotent by commercial-amendment authority.

The currently reachable commercial contract remains intentionally narrow: one applied `REFUND` amendment against the original immutable tax-invoice baseline, standard GST before and after, one issued legal adjustment only, and fully reconciled settlement. No ordinal `2+` route or UI action exists.

## Read integrity

Authenticated adjustment-note detail, register, accounting export, and reconciliation reads require both `booking:read` and `payment:read`. They validate the row/snapshot/document fingerprint, revalidate the complete immutable source tax invoice, and then validate reason-specific authority.

Public booking-capability reads enforce independent customer authorization first, then apply the same legal-evidence checks. Revoked or expired public principals are rejected before legal-document history is loaded.

Current authenticated/public readers deliberately reject persisted schema-version-3/ordinal-2+ documents until predecessor-chain read validation is implemented. Unknown reasons, cross-tenant links, material-column drift, source-invoice drift, stale amendment evidence, malformed target pricing evidence, or broken authority fail closed.

## Next service dependency

The persistence blocker is now removed, but repeated/cumulative issuance must not be enabled until the service boundary can independently consume the chain contract. The next coherent slice is serializable chain-head selection and full predecessor revalidation, then reason-specific authenticated/public reads, accounting/reconciliation, HTML/PDF delivery, and only then a real repeated-adjustment issuance action.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, generic correction/void/reissue, and other jurisdictions remain separate contracts.

## Validation status

The commercial readiness suite covers first, second, and third decreasing-adjustment baseline assessment plus count, ordinal, chronology, identity, tax, target, and settlement failures. The immutable snapshot suite covers schema-version-2 compatibility and schema-version-3 predecessor binding/round-trip/fail-closed behavior. A dependency-free migration contract test now checks the Prisma predecessor fields, same-tenant/booking/source/reason composite self-FK, contiguous ordinal rule, no-fork/self-predecessor rules, and preservation of schema versions 1/2 while admitting only structurally valid schema-version-3 repeated rows.

Full Node 24 repository validation, Prisma migration verification, PostgreSQL constraint/integration tests, universal Unicode-safe PDF support, and jurisdiction/legal review remain required before the broader lifecycle is treated as production complete.
