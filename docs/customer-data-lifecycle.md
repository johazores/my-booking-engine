# Customer data lifecycle

## Scope

SF now provides a narrow, irreversible de-identification workflow for the mutable customer profile only. It is deliberately fail-closed and does not claim to be a universal privacy-erasure workflow.

The current product action is available only when all of the following are true:

- the operator is authenticated in the active organization and has `customer:manage`;
- the customer belongs to that organization and is already `ARCHIVED`;
- the operator explicitly types `DEIDENTIFY`; and
- the customer has **zero hospitality booking references** in that organization.

When those conditions hold, one serializable transaction replaces the mutable customer name with the generic `De-identified Customer` label, clears email, phone, and internal notes, and writes a tenant-scoped `customer.deidentified` audit event. The audit records only lifecycle state and the names of fields cleared; it does not copy the removed values.

The operation is intentionally not exposed for active customers and does not infer disposal authority from age, archive date, inactivity, or a generic retention timer.

## Why booking-linked customers are blocked

A customer referenced by a booking can also have immutable or operational evidence containing personal information. The current de-identification workflow therefore blocks on **any** hospitality booking reference rather than presenting a misleading partial-erasure action.

This workflow does not mutate or delete booking guest snapshots, payment records, provider records, public booking capability state, tax-invoice/adjustment-note recipient snapshots, or other immutable legal/accounting evidence. Those records require their own reviewed retention and disposal authority.

## Legal and privacy boundary

Australian Privacy Principle 11 requires covered entities to actively consider whether personal information is still needed and, subject to legal-retention exceptions, take reasonable steps to destroy or de-identify information that is no longer needed. OAIC guidance also notes that reasonable steps must address copies an organization holds and that de-identification must leave information no longer about an identifiable or reasonably identifiable individual.

Australian GST record-keeping obligations can require relevant records to be retained for at least five years and long enough to cover applicable periods of review. SF therefore preserves issued tax/accounting evidence and never treats a customer archive date or a five-year threshold as automatic disposal authority.

References reviewed for this contract:

- OAIC, APP Guidelines, Chapter 11: Security of personal information (updated 3 October 2025).
- Australian Taxation Office, Records required for GST / How long you need to keep GST records.

This product boundary is an engineering control, not legal advice. Tenants remain responsible for determining when they no longer need a bookingless customer profile and whether another law, court/tribunal order, dispute, or operational purpose requires retention.

## Operational behavior

The customer detail page clearly distinguishes archival from profile de-identification. A successful operation leaves a non-identifying customer stub so historical internal audit references remain resolvable, but the mutable customer directory no longer contains the prior direct profile identifiers.

Request correlation uses the existing `customer.deidentify` operation. Structured request logs include the tenant organization only after active-organization authority succeeds and do not include the customer ID, form body, confirmation phrase, removed identifiers, or request URL.

## Remaining lifecycle work

Broader customer-data disposal remains open for booking-linked customers and for copies held in booking guest snapshots, public capability/principal records, provider systems, payment records, backups, exports, and legally retained documents. That work needs a separately reviewed retention matrix, provider-specific adapter behavior where applicable, legal-document constraints, and live PostgreSQL verification before SF can claim a complete customer-erasure lifecycle.
