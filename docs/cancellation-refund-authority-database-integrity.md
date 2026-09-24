# Cancellation refund authority database integrity

## Scope

Schema-version-6 Australian cancellation-after-amendment adjustment notes freeze a bounded ordered refund-authority set in `HospitalityIssuedAdjustmentNote.documentSnapshot`. Application issuance and historical verification already validate that evidence. The database now adds an independent direct-write backstop so a SQL/ORM bypass cannot persist malformed frozen refund membership while still satisfying only the outer adjustment-note row shape.

The migration `20260924202500-hospitality-v6-refund-authority-db-integrity` adds `sf_hospitality_v6_refund_authorities_valid` and the `hospitality_adj_notes_v6_refund_authorities_check` constraint. The function deliberately returns true for every non-schema-6 document so older legal contracts retain their existing rules instead of gaining inferred authority.

## Frozen membership contract

Every schema-version-6 refund entry must be an exact four-field refund authority containing only:

- `refundTransactionId`: one canonical UUID, unique inside the frozen set;
- `refundOrdinal`: a positive integer string equal to the entry position, starting at 1;
- `amountMinor`: a positive integer minor-unit string; and
- `createdAt`: a timestamp strictly after the commercial predecessor and no later than the adjustment-note issue time.

The array remains bounded to 1–256 entries. The database rejects duplicate refund IDs, ordinal gaps/reordering, malformed timestamps, unexpected fields, non-positive money, and any set whose summed frozen amount does not equal the persisted legal decrease total. The constraint is added `NOT VALID` and immediately validated, so a deployment fails rather than silently grandfathering malformed retained schema-version-6 legal evidence.

## Mutable provider truth stays separate

The immutable snapshot intentionally does not freeze payment provider lifecycle status or provider references. Schema-version-6 issuance still requires successful provider-neutral refund authority inside the serializable application writer. Historical legal verification later reloads the exact frozen tenant-owned refund IDs and re-proves structural identity, source attribution, money, and chronology without treating mutable current status as historical truth.

Current provider lifecycle state remains an operational reconciliation concern. If one of the frozen refunds later moves away from `SUCCEEDED`, tax-document reconciliation reports `SETTLEMENT_DRIFT`; it does not rewrite, delete, hide, or invalidate the immutable issued document.

## Deliberate remaining boundary

This database guard strengthens schema version 6 only. It does **not close** the separate commercial-amendment settlement-evidence problem for schemas 2 through 5. Those historical documents still need a deliberate versioned issue-time settlement-evidence contract before their legal authority can be independent of later mutable provider-status changes. No historical transaction membership is inferred here.

Live application of the migration and direct-insert PostgreSQL verification remain part of the guarded disposable-database validation path and must not be claimed unless an explicitly disposable PostgreSQL target is available.
