# Hospitality tax-document read consistency

Australian hospitality tax-document collection reads are tenant-scoped, authorization-checked, bounded, and snapshot-consistent at the presentation boundary. A single register/history response must not combine a collection count from one PostgreSQL observation with rows from another.

## Staff tax-invoice registers

Authenticated tax-invoice collection reads continue to require both `booking:read` and `payment:read` before the database collection is read.

- Booking-scoped tax-invoice history verifies the booking with both `bookingId` and `organizationId` inside the same PostgreSQL `RepeatableRead` transaction used for the invoice count and page.
- Organization tax-invoice history reads its tenant-scoped count and page from one `RepeatableRead` snapshot.
- Requested pages are validated and then clamped to the authoritative page count from that snapshot.
- Ordering remains deterministic by `issuedAt desc, id desc`.

The existing immutable invoice snapshot/fingerprint validation remains mandatory after the page is loaded.

## Staff adjustment-note register

The tenant adjustment-note register also reads its count, clamped page, and ordered rows from one `RepeatableRead` snapshot. Existing `booking:read` and `payment:read` authorization is unchanged.

Adjustment-note rows pass through the shared legal authority verifier inside the same `RepeatableRead` transaction that loads the register page. Source invoice, refund, amendment, predecessor, pricing, and settlement evidence therefore share the selected-row snapshot while remaining fail-closed. Snapshot-consistent pagination is not a substitute for complete legal authority.

## Public capability-owned history

Public legal-document history first verifies the signed booking capability against the active organization resolved from the public slug. Persisted capability ownership, unexpired principal state, tenant-owned booking existence, tax-invoice count/rows, and adjustment-note count/rows are then read from one `RepeatableRead` transaction.

This prevents one response from authorizing against one persisted ownership state while projecting legal-document collection metadata from a later state. Adjustment-note source/refund/commercial authority is also verified inside that same snapshot before customer-safe projection. The public projection remains fixed at 50 tax invoices and 50 adjustment notes and reports `truncated` from totals observed in that same snapshot.

The public response remains customer-safe. It does not expose internal legal fingerprints, payment/provider references, amendment IDs, pricing-evidence IDs, or other server-only authority fields.

## Pagination is not legal completeness

These collection boundaries are presentation/read models only. A paginated or truncated legal-document history never proves settlement, adjustment-chain completeness, refund authority, reconciliation completeness, or issuance eligibility.

Commercial decisions continue to use the dedicated bounded-completeness readers and legal authority services. Accounting exports retain their explicit hard limits. Reconciliation retains its dedicated bounded verification contract. Writers continue to use their existing serializable/advisory-lock/idempotency boundaries.
