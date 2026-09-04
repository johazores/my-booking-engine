# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, and delivery so no browser action or mutable customer/pricing record can become legal-document authority by accident.

The implemented issuance foundation currently supports only the narrow Australian `TAX_INVOICE` contract documented in `docs/australian-tax-invoice-contract.md`.

## Persistence

`HospitalityInvoicePreparation` freezes the accepted pricing evidence, issuer fingerprint, immutable recipient snapshot/fingerprint, exact money, and document preparation fingerprint.

`HospitalityInvoiceNumberSequence` owns the next integer sequence by:

- `organizationId`;
- `jurisdictionCode`; and
- `documentType`.

The first supported tuple is `AU / TAX_INVOICE`. Allocation happens in the same serializable transaction that creates the issued invoice. A failed transaction cannot commit only the sequence increment.

`HospitalityIssuedInvoice` stores the committed immutable document identity and evidence:

- organization, booking, preparation, pricing-evidence, and issuer-profile identity;
- jurisdiction, document type, document number, and numeric sequence;
- issuing actor and issue timestamp;
- exact integer minor-unit money and currency;
- preparation, pricing, issuer, recipient, and document fingerprints; and
- the complete immutable document snapshot used by renderers.

PostgreSQL composite foreign keys independently prevent cross-tenant or cross-booking references. Unique constraints prevent two issued documents for one preparation and prevent duplicate tenant/jurisdiction numbers or sequence values.

## Server authority

`issueHospitalityAustralianTaxInvoice` requires `payment:manage` before reading tenant-owned issuance data.

A first issuance must pass the shared Australian preparation-verification boundary, which validates the immutable preparation and recipient, issuer, accepted pricing evidence, exact money, and current accepted booking commercial state. The service then derives the sequence, number, issue time, legal snapshots, and document fingerprint server-side.

The caller cannot submit legal/tax money, invoice number, sequence, issuer, recipient, tax lines, or document fingerprint as authority.

A retry first looks for the already-issued `(organizationId, preparationId)` record and validates its immutable snapshot/fingerprint. This preserves idempotency even after later booking changes. A not-yet-issued stale preparation is rejected before sequence allocation.

## Read, rendering, accounting export, and delivery boundary

Authenticated staff invoice reads require both `booking:read` and `payment:read`. Issuance remains a separate `payment:manage` operation. This keeps read-only staff able to inspect already-issued tenant documents without granting authority to create new legal documents or mutate commercial/payment state.

Invoice-history reads independently verify that the requested booking exists inside the active organization before counting or returning issued documents. The booking workspace shows the latest ten documents and links to a dedicated paginated history for larger collections. Authenticated invoice detail and history routes still re-enter the server authorization and tenant/resource boundaries; route visibility is not authority.

`/invoices` now provides the same permission-checked immutable evidence as a tenant-wide paginated Australian tax-invoice register. Its accounting CSV export is generated server-side only after every exported `HospitalityIssuedInvoice` passes the same material-column, frozen-snapshot, and document-fingerprint integrity checks used by the renderer. The export contains document number, issue timestamp, booking identifier, currency, accommodation, fee, add-on, GST, and invoice totals using exact currency decimal strings. It never exports mutable customer/booking display data, credentials, provider references, card data, idempotency keys, or internal payment references.

The accounting export is deliberately bounded to 5,000 invoices and fails without returning a partial file when the tenant exceeds that limit. This prevents an unbounded authenticated read from becoming a resource-exhaustion path; future larger exports should use explicit date/range selection or an asynchronous export architecture only when there is a concrete operational requirement. The CSV is an accounting/interchange aid, not a legal tax-invoice artifact and not a substitute for deterministic PDF delivery.

Both the authenticated invoice page and the capability-owned public booking document surface render from the immutable `HospitalityIssuedInvoice.documentSnapshot` after its material columns and SHA-256 document fingerprint are revalidated. The booking workspace loads read-only invoice history independently from amendment/recovery management permissions, so lacking write authority no longer hides documents the actor is allowed to read.

Browser Print/Save is a convenience over the verified immutable issued record. It is not a deterministic SF-generated PDF artifact and must not be represented as one. The public customer surface is still bounded by the existing 24-hour booking recovery capability; durable re-authenticated customer access, email delivery/resend, and long-term history remain open production work.

The existing payment receipt remains separate settlement evidence. It must not be transformed into a tax invoice by UI wording alone.

## Corrections

Issued rows are historical evidence and must not be edited to reflect later refunds or commercial amendments. Correction/credit-note/reissue work must create its own immutable linked document lifecycle and numbering rules.
