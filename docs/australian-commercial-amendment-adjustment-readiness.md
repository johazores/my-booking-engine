# Australian commercial-amendment adjustment readiness

## Purpose

SF has server-side readiness, issuance, read, PDF, accounting, reconciliation, and public-delivery contracts for the first Australian hospitality commercial-amendment decreasing adjustment. The contract remains deliberately narrow so legal-document behavior cannot outrun immutable evidence.

The cumulative foundation now includes domain readiness, schema-version-3 immutable predecessor evidence, PostgreSQL predecessor-chain constraints, and a tenant-scoped server verifier that can reload and independently validate the complete persisted commercial predecessor chain. Repeated issuance remains deliberately unreachable until the issuance and downstream read/delivery paths consume that verified chain end to end.

## Authority

Readiness and issuance require `payment:manage`. Authenticated legal-document reads require `booking:read` plus `payment:read`.

Inside tenant- and booking-scoped transactions SF derives legal authority from persisted evidence. Browser input never supplies GST, money, currency, provider truth, settlement source, amendment direction, pricing fingerprints, sequence numbers, or predecessor authority.

## First decreasing-adjustment contract

The currently issued first adjustment succeeds only when the AU/AUD source tax invoice reconciles, the amendment is applied `REFUND`, its before-price exactly equals the immutable source invoice, its after-price equals exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` record, no earlier legal adjustment exists, standard GST reconciles before/after/decrease, and provider-neutral settlement is complete at the after-total. Legal chronology must also be valid.

## Cumulative readiness contract

For a second or later commercial decrease, the readiness domain requires the complete verified predecessor set. It rejects missing evidence, count or ordinal gaps, duplicate identities/fingerprints, chronology regressions, non-standard-GST decreases, source-to-chain price drift, predecessor-to-predecessor price drift, next-amendment baseline drift, and an amendment applied before the immediate predecessor document.

A valid assessment returns the exact next `sourceAdjustmentOrdinal` and immediate predecessor identity needed to create schema-version-3 evidence.

## Persisted and verified chain

`HospitalityIssuedAdjustmentNote` carries nullable `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal`. PostgreSQL preserves ordinal-1 cancellation/schema-version-1 and first-commercial/schema-version-2 rows while enforcing same-tenant/same-booking/same-source/same-reason predecessor authority, contiguous ordinals, no forks, and no self-predecessor for ordinal `2+` schema-version-3 commercial rows.

Server verification is now explicit rather than relying on those structural constraints alone:

- `loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the exact source invoice and complete persisted chain in the caller's transaction;
- every adjustment snapshot is reparsed and its canonical fingerprint recomputed;
- every applied commercial amendment and exact target pricing-evidence row is reloaded inside the same tenant + booking scope;
- target pricing breakdowns must reconcile to material columns and fingerprints;
- every row/snapshot authority must agree on organization, booking, source invoice, document identity, money, party fingerprints, amendment and target identity;
- schema-version-3 predecessor id/document number/issue time/document fingerprint/after-pricing fingerprint must equal the actual preceding verified row;
- full before/after prices must remain continuous from source invoice through the chain; and
- mixed cancellation/commercial chains fail closed.

The verifier returns the complete `priorAdjustments` readiness evidence, expected next ordinal, and exact verified chain head. A 5,000-document source-chain limit prevents partial validation of an unbounded legal register.

For write selection, `selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` acquires a PostgreSQL transaction advisory lock keyed by tenant + booking + source invoice before reloading the chain. Repeated issuance must call that boundary from its serializable transaction; the database uniqueness constraints remain an independent backstop against forks or duplicate ordinals.

## Provider-neutral settlement versus legal authority

Payment settlement proves money movement; it does not establish the legal tax-document baseline. A commercial refund can span payment sources, so SF reconciles amendment settlement through the provider-neutral payment ledger. The legal authority remains the applied commercial amendment plus immutable target pricing evidence, and repeated legal authority additionally depends on the verified predecessor chain.

## Current issuance workflow

`issueHospitalityCommercialAmendmentAdjustmentNote` is still first-adjustment-only. It creates schema-version-2 ordinal-1 evidence and does not yet call the new locked predecessor-chain head selector. The authenticated tax-invoice page therefore exposes a commercial issuance action only for one unambiguous first adjustment.

No ordinal `2+` route or primary action is exposed merely because the database and verifier can represent the chain.

## Read and downstream status

Authenticated detail/register/accounting/reconciliation, deterministic PDF, and public booking-capability history still support the current ordinal-1 reasons only. Schema-version-3 rows continue to fail closed in those readers. This prevents a service-foundation change from accidentally becoming customer-visible legal-document delivery before each downstream surface uses the same complete chain validation.

## Next dependency

The next production slice is to wire repeated commercial issuance to the locked verified chain head and cumulative readiness result, persist schema-version-3 evidence with the exact predecessor fields, and keep idempotency/sequence/audit behavior serializable. After issuance is safe, authenticated/public reads, accounting, reconciliation, HTML, and PDF delivery must be switched to the same complete chain verifier before the repeated-adjustment action becomes reachable.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/PostgreSQL validation, and jurisdiction/legal review remain separate boundaries.
