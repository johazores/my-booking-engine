# Commercial adjustment settlement reconciliation

SF now performs an explicit current-settlement replay for issued Australian commercial-amendment adjustment notes (snapshot schema versions 2 through 5) during the bounded tax-document reconciliation run.

## Authority boundary

Only tenant-scoped `COMMERCIAL_AMENDMENT` adjustment-note rows whose immutable snapshot parses successfully and whose canonical document fingerprint still matches the persisted fingerprint can become reconciliation authorities. The snapshot must still agree with the row on organization, booking, source invoice, adjustment ordinal, document number, issue time, commercial amendment, currency, and direction.

The referenced commercial amendment is reloaded inside the same tenant and must still be `APPLIED`, belong to the same booking, match the document direction, currency, before total, after total, delta, exact applied timestamp, and the immutable before/after pricing fingerprints frozen into the legal snapshot. The snapshot's exact target-pricing evidence row is also reloaded inside the tenant and must still belong to the same booking and commercial amendment, remain `COMMERCIAL_AMENDMENT_TARGET` evidence, and match the document currency, after-total, and after-pricing fingerprint. Malformed or drifted legal evidence is not reclassified as settlement drift; the existing immutable register/read authority owns those failures.

## Current settlement replay

For a verified legal chain, settlement is replayed with the same provider-neutral commercial-amendment state machine used by booking management. The replay includes only:

- base booking payment transactions with no commercial-amendment owner;
- transactions owned by commercial amendments in the same verified source-invoice chain up to the document being checked; and
- transactions created no later than that adjustment note's immutable issue time.

A document reports `SETTLEMENT_DRIFT` when current persisted transaction state no longer produces `READY_TO_APPLY`, the exact adjustment amount is no longer fully settled, a remaining amount appears, or the current net settlement no longer equals the amendment's after-total.

The scan is tenant-scoped and bounded. It refuses to produce a partial successful reconciliation result if the commercial adjustment-note or payment-transaction scan exceeds its synchronous limit.

## Deliberate remaining boundary

This reconciliation is current-state observability, not a substitute for versioned issue-time settlement evidence. Schema versions 2 through 5 still derive their historical settlement proof from persisted transactions that existed by the document issue time, and those transaction statuses can later change as provider truth is reconciled.

A future schema version must freeze the exact issue-time settlement authorities needed for historical legal reads before SF can safely remove mutable current payment status from the commercial adjustment-note read boundary. Existing schema versions are not rewritten in place.
