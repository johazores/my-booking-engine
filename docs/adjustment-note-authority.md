# Australian adjustment-note authority

SF treats an issued Australian adjustment note as immutable legal evidence. The reachable product currently exposes booking-cancellation and first commercial-amendment decreasing adjustments at source ordinal `1`. The repository now also contains the complete protected write boundary needed to persist a repeated commercial-amendment adjustment at ordinal `2+`, but that repeated write remains intentionally unreachable until every downstream read and delivery surface is chain-aware.

## Current issued authority model

`HospitalityIssuedAdjustmentNote` supports:

- `BOOKING_CANCELLATION`, authorized by one attributed successful full-booking refund transaction; and
- `COMMERCIAL_AMENDMENT`, authorized by the exact applied commercial amendment plus its immutable `COMMERCIAL_AMENDMENT_TARGET` pricing evidence. Commercial settlement can span payment sources, so SF does not invent one synthetic refund transaction as legal authority.

Cancellation documents remain schema version 1 / ordinal `1`. First commercial-amendment documents remain schema version 2 / ordinal `1`. Repeated commercial-amendment documents use schema version 3 / ordinal `2+` and bind the immediate predecessor document.

## Cumulative predecessor-chain contract

A repeated decreasing commercial adjustment is valid only when the complete predecessor set is verified. Ordinals must be contiguous from `1`, identities and fingerprints must be unique, chronology cannot regress, every decrease must remain exact AUD standard GST, the first adjustment must begin at the immutable source-invoice price, and each later amendment before-price must equal the preceding adjustment after-price.

Schema version 3 freezes:

- the immediate predecessor adjustment-note id;
- predecessor source ordinal;
- predecessor document number and issue time;
- predecessor document fingerprint; and
- predecessor after-pricing fingerprint, which must equal the new amendment before-pricing fingerprint.

`HospitalityIssuedAdjustmentNote` persists `predecessorAdjustmentNoteId` and `predecessorSourceAdjustmentOrdinal`. PostgreSQL independently enforces same-tenant, same-booking, same-source-invoice and same-reason predecessor scope, the exact previous ordinal, no self-predecessor, and one-successor/no-fork semantics.

## Server chain verification

`loadVerifiedHospitalityCommercialAmendmentAdjustmentChain` reloads the exact AU source tax invoice, the complete persisted commercial adjustment chain, every referenced applied commercial amendment, and every immutable target pricing-evidence row inside tenant + booking + source-invoice scope. It reparses canonical snapshots, recomputes document fingerprints, revalidates target pricing breakdowns, and verifies all material money/fingerprint links.

The pure chain validator checks source identity, party fingerprints, contiguous ordinals, predecessor row and snapshot identity, frozen predecessor document number/time/fingerprint, amendment chronology, source/predecessor-to-amendment price continuity, target-pricing authority, and standard-GST decreases. Mixed cancellation/commercial chains fail closed. The source chain is bounded to 5,000 documents.

`selectVerifiedHospitalityCommercialAmendmentAdjustmentChainHeadForWrite` acquires a PostgreSQL transaction advisory lock for the tenant + booking + source invoice before reloading the verified head. Database uniqueness remains the final independent fork/ordinal backstop.

## Repeated write boundary

`issueHospitalityRepeatedCommercialAmendmentAdjustmentNote` now implements the protected ordinal-`2+` write path. It requires `payment:manage` and runs in a serializable transaction. The service:

1. scopes the source invoice, amendment, target pricing evidence, payment ledger, and adjustment chain to the supplied tenant + booking;
2. refuses mixed/non-commercial legal history;
3. acquires the chain advisory lock and verifies the complete predecessor chain;
4. derives provider-neutral amendment settlement from persisted payment transactions;
5. reruns cumulative Australian readiness using the complete verified `priorAdjustments` set;
6. requires the readiness ordinal and predecessor identity to equal the locked chain head;
7. allocates the shared `AU / ADJUSTMENT_NOTE` sequence inside the same transaction;
8. creates schema-version-3 immutable evidence from the exact predecessor head;
9. persists the relational predecessor id/ordinal alongside the document snapshot and fingerprint;
10. reloads the complete chain and requires the created row to be the new verified head before audit and commit; and
11. preserves idempotency by commercial-amendment authority and retries only supported write-conflict classes.

The browser never supplies GST, amounts, currency, provider truth, settlement state, sequence, issue time, party evidence, fingerprints, or predecessor authority.

## Reachability and downstream safety

The existing API route and authenticated tax-invoice action still call the first-adjustment-only issuance service. They do **not** call `issueHospitalityRepeatedCommercialAmendmentAdjustmentNote`.

Authenticated/public adjustment readers, register/accounting projections, tax-document reconciliation, HTML, and PDF delivery still reject schema-version-3 rows. Keeping the new write boundary internal prevents SF from creating a customer-visible legal document that its normal read surfaces cannot independently verify and deliver.

Authenticated legal-document reads require both `booking:read` and `payment:read`; issuance requires `payment:manage`. Public booking-capability reads enforce their independent customer authorization boundary before tax-document history is loaded.

## Next dependency

The next coherent slice is to switch staff/public commercial-adjustment reads, accounting/reconciliation, HTML, and PDF delivery to the complete verified-chain boundary. Only after those projections accept schema-version-3 evidence safely should availability and the API/UI be changed to expose repeated issuance.

Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, generic correction/void/reissue, durable customer re-authentication/email delivery, Unicode-safe PDF rendering, reviewed disposal/de-identification, production Node 24/PostgreSQL validation, and jurisdiction/legal review remain separate production boundaries.
