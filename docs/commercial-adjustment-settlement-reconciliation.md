# Commercial adjustment settlement reconciliation

SF performs an explicit current-settlement replay for issued Australian commercial-amendment adjustment notes (snapshot schema versions 2 through 5) during the bounded tax-document reconciliation run.

## Authority boundary

Only tenant-scoped `COMMERCIAL_AMENDMENT` adjustment-note rows whose immutable snapshot parses successfully and whose canonical document fingerprint still matches the persisted fingerprint can become reconciliation authorities. The snapshot must still agree with the row on organization, booking, source invoice, adjustment ordinal, document number, issue time, commercial amendment, target pricing evidence, currency, and direction.

The referenced source tax invoice is reloaded inside the same tenant and its immutable snapshot and canonical document fingerprint are revalidated before the source chain can participate in settlement-drift classification. Its booking, document number, issue time, currency, document fingerprint, issuer fingerprint, and recipient fingerprint must match the source authority frozen into every commercial adjustment note. The first commercial amendment must start from the source invoice's exact total and pricing fingerprint.

The referenced commercial amendment is reloaded inside the same tenant and must still be `APPLIED`, belong to the same booking, match the document direction, currency, before total, after total, delta, exact applied timestamp, and the immutable before/after pricing fingerprints frozen into the legal snapshot. The snapshot's exact target-pricing evidence row is also reloaded inside the tenant and must still belong to the same booking and commercial amendment, remain `COMMERCIAL_AMENDMENT_TARGET` evidence, and match the document currency, after-total, and after-pricing fingerprint. Malformed or drifted legal evidence is not reclassified as settlement drift; the existing immutable register/read authority owns those failures.

Current settlement classification is chain-atomic. SF revalidates the entire source-invoice commercial chain before replaying payment state: ordinals must be contiguous, document/amendment/target identities must not repeat, issue chronology must remain monotonic, each later amendment must not predate its legal predecessor, every step must preserve exact currency and monetary continuity from the previous after-total into the next before-total, and every step's before-pricing fingerprint must equal the previous step's after-pricing fingerprint. If the source invoice, an intermediate current amendment, target-pricing row, or amount/fingerprint continuity no longer matches its frozen legal authority, the entire chain is excluded from settlement-drift classification. This prevents transactions owned by a broken source or intermediate step from contaminating a later document's current-settlement conclusion; immutable register/source-link reconciliation remains the authority for that integrity failure.

## Current settlement replay

For a verified legal chain, settlement is replayed with the same provider-neutral commercial-amendment state machine used by booking management. The replay includes only:

- base booking payment transactions with no commercial-amendment owner;
- transactions owned by commercial amendments in the same fully verified source-invoice chain up to the document being checked; and
- transactions created no later than that adjustment note's immutable issue time.

The replay intentionally reads the **current lifecycle status** of those historically eligible payment rows. A document reports `SETTLEMENT_DRIFT` when current persisted provider/payment state no longer produces `READY_TO_APPLY`, the exact adjustment amount is no longer fully settled, a remaining amount appears, or current net settlement no longer equals the amendment's after-total.

That current-state replay is operational observability only. It does not redefine the immutable issue-time settlement authority that allowed the adjustment note to be issued.

## Historical issue-time settlement evidence

Newly issued schema-version-2-through-5 commercial adjustment notes freeze their provider-neutral issue-time payment ledger through the commercial settlement-evidence contract. Historical legal verification prefers that frozen evidence and does not let later mutable provider-status changes rewrite issue-time authority.

Pre-migration commercial documents are intentionally not backfilled because SF cannot truthfully reconstruct provider status that was not frozen at issuance. A commercial chain may therefore have a leading legacy prefix followed by a contiguous frozen-evidence suffix. Once frozen evidence begins, any later missing frozen evidence fails closed instead of silently falling back to mutable current payment state.

Current reconciliation remains deliberately separate from that historical authority: it compares the current lifecycle state visible for the same historically eligible payment identities against the immutable legal chain and may report drift without rewriting, hiding, voiding, or invalidating the issued document.

## Snapshot consistency and bounded execution

When commercial settlement drift runs as part of `reconcileHospitalityAustralianTaxDocuments`, the caller passes the reconciliation transaction into `currentHospitalityCommercialAdjustmentSettlementDriftFailuresInTransaction`. Adjustment-note rows, source invoices, commercial amendments, target pricing evidence, bounded payment history, register validation, other settlement-drift checks, report construction, and the reconciliation audit insert therefore observe the same caller-owned PostgreSQL `RepeatableRead` snapshot.

The standalone `currentHospitalityCommercialAdjustmentSettlementDriftFailures` entry point remains available for callers without an existing transaction and wraps the same transaction-aware core in its own `RepeatableRead` transaction.

The scan is tenant-scoped and bounded. It refuses to produce a partial successful reconciliation result if the commercial adjustment-note or payment-transaction scan exceeds its synchronous limit. Reconciliation performs no live provider calls.

## Deliberate remaining boundary

The remaining historical limitation is the pre-migration legacy prefix whose original provider statuses were never frozen and cannot be reconstructed truthfully from mutable current state alone. Existing legal documents are not rewritten or backfilled with invented evidence.

Mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, other jurisdictions, durable customer re-authentication and email delivery, universal Unicode-safe PDF rendering, reviewed retention/disposal, live Node 24/Prisma/PostgreSQL execution, live-provider verification, and jurisdiction-specific legal review remain separate production gates.
