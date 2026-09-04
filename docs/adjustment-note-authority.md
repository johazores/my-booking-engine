# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The current reachable issuance path supports booking-cancellation and first commercial-amendment decreasing adjustments at source ordinal `1`. Persistence and server validation now also define a fail-closed linear predecessor-chain foundation for future repeated commercial-amendment adjustments; repeated issuance and delivery remain unreachable.

## Current issued authority model

`HospitalityIssuedAdjustmentNote` currently issues:

- `BOOKING_CANCELLATION`, authorized by exactly one attributed successful full-booking refund transaction; and
- `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record. Amendment settlement can span payment sources, so SF does not invent one synthetic refund transaction as legal authority.

Cancellation documents remain schema version 1 / ordinal `1`. First commercial-amendment documents remain schema version 2 / ordinal `1`. Commercial before/after standard-GST totals and pricing fingerprints live in immutable document evidence and reconcile to material decrease columns through database and server checks.

## Cumulative commercial-amendment contract

The commercial-amendment readiness domain accepts a second or later decreasing adjustment only from a complete verified predecessor set. Ordinals must be contiguous from `1`, identity and fingerprints must be unique, chronology cannot regress, every decrease must remain exact AUD standard GST, the first predecessor must begin at the immutable source-invoice price, each later predecessor must begin at the preceding after-price, and the next amendment must begin at the verified chain head.

Schema version 3 preserves the schema-version-2 commercial evidence and additionally binds the immediate predecessor adjustment-note id, document number, issue time, document fingerprint, and predecessor after-pricing fingerprint. That predecessor after-pricing fingerprint must equal the new document before-pricing fingerprint.

## Persisted predecessor-chain contract

`HospitalityIssuedAdjustmentNote` includes nullable `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal` authority for ordinal `2+` commercial documents. PostgreSQL independently enforces:

- same tenant, booking, original source invoice, adjustment reason, and exact previous ordinal through a composite self foreign key;
- `predecessorSourceAdjustmentOrdinal = sourceAdjustmentOrdinal - 1`;
- one successor per predecessor, preventing forks;
- no self-predecessor;
- schema-version-1 cancellation and schema-version-2 first-commercial rows remain ordinal `1` with no predecessor; and
- schema-version-3 commercial rows require ordinal `2+` and predecessor authority.

## Server predecessor-chain verification

The service layer now has a reusable predecessor-chain verification boundary for the persisted commercial chain.

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the exact AU source tax invoice, every adjustment row, every applied commercial amendment, and every immutable target pricing-evidence record inside the caller's transaction and tenant + booking + source-invoice scope. It reparses the canonical tax-invoice and adjustment snapshots, recomputes their document fingerprints, revalidates target pricing breakdowns, and verifies material money/fingerprint agreement before a row can participate in the chain.

The pure chain validator then requires contiguous ordinals and checks every row/snapshot/authority link, including source-invoice identity, party fingerprints, predecessor row identity, predecessor frozen document number/time/fingerprint, amendment chronology, exact source/predecessor-to-amendment price continuity, target-evidence agreement, and standard-GST decrease reconciliation. Mixed cancellation/commercial chains fail closed.

`selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` additionally acquires a PostgreSQL transaction advisory lock over the tenant + booking + source-invoice chain before loading the verified head. It is intended to be called from the existing serializable legal-document issuance transaction so two writers cannot safely select the same predecessor head merely by racing reads. Database uniqueness remains the final independent no-fork/ordinal guard.

The loader is bounded to 5,000 documents for one source invoice and fails closed above that limit rather than validating a partial legal chain.

## Current issuance and delivery boundary

Booking-cancellation issuance retains its existing `payment:manage`, full-refund attribution, source-invoice integrity, sequence, idempotency, serializable transaction, and safe audit requirements.

First commercial-amendment issuance also remains server-authoritative and first-adjustment-only. It requires `payment:manage`, re-runs source invoice, target evidence, standard-GST, applied-amendment, and provider-neutral settlement checks in a serializable transaction, allocates the shared `AU / ADJUSTMENT_NOTE` sequence, creates schema-version-2 immutable evidence, and is idempotent by commercial amendment.

The new chain verifier does **not** make ordinal `2+` issuance reachable. The existing issuance route/action still creates only schema-version-2 ordinal-1 commercial documents. Authenticated/public readers, accounting/reconciliation, HTML, and PDF delivery also continue to reject schema-version-3 rows until those surfaces are explicitly switched to the verified-chain boundary.

## Authorization and read integrity

Authenticated adjustment-note detail/register/accounting/reconciliation reads require both `booking:read` and `payment:read`; issuance requires `payment:manage`. Public booking-capability reads enforce their independent customer authorization boundary before legal-document history is loaded. Provider/payment references, credentials, secrets, and mutable browser claims are never document authority.

Unknown reasons, cross-tenant links, material-column drift, source-invoice drift, stale amendment or pricing evidence, malformed snapshots, broken predecessor authority, and unsupported repeated-delivery paths fail closed.

## Next dependency

The service verification blocker is removed. The next coherent slice is to make repeated commercial issuance consume the locked verified chain head and readiness result to create schema-version-3 evidence, then move authenticated/public reads, accounting/reconciliation, HTML, and PDF delivery onto the same chain validator before exposing any repeated-adjustment action.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, generic correction/void/reissue, and other jurisdictions remain separate contracts.

## Validation status

The cumulative readiness suite covers first, second, and third decreasing-adjustment baseline assessment. The immutable snapshot suite covers schema-version-2 compatibility and schema-version-3 predecessor binding. The migration contract suite checks the PostgreSQL chain shape. The chain-verification domain suite covers a valid cumulative head plus predecessor-pointer drift, immutable predecessor-fingerprint drift, target-breakdown drift, legal-baseline drift, and chronology failure.

Full Node 24 repository validation, Prisma migration verification, PostgreSQL constraint/concurrency execution, universal Unicode-safe PDF support, and jurisdiction/legal review remain required before the broader lifecycle is treated as production complete.
