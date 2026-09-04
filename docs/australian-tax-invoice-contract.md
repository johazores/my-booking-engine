# Australian tax-invoice contract

## Status

Australia is the first explicit jurisdiction contract for SF's regulated hospitality invoice workflow. The contract remains deliberately narrow and fail-closed.

SF now has four separate server-side/document authorities:

1. immutable invoice preparation, including a frozen individual or business recipient snapshot;
2. Australian content/readiness assessment over immutable issuer, recipient, and accepted pricing evidence;
3. concurrency-safe allocation of an immutable issued tax-invoice identity/evidence record; and
4. customer-safe rendering of immutable issued tax invoices through the existing capability-owned public booking document surface.

The public document renders the explicit `Tax invoice` identity, immutable issue date and document number, seller and buyer identities, applicable ABNs, frozen supply lines, GST, and total. A customer holding the existing valid booking document capability can view recent issued invoices and use the browser's Print/Save function to keep a copy.

That public access remains intentionally bounded by the existing public-booking recovery principal/capability, currently 24 hours from public booking confirmation. It is not a durable customer account, permanent invoice link, or email-delivery channel. Browser printing is also a customer convenience over the immutable issued record; it is not an SF-generated deterministic PDF artifact.

This does **not** mean SF has completed production-compliant Australian tax-invoice delivery. Correction/adjustment documents, durable customer access and resend, deterministic PDF generation, email delivery, retention/accounting behavior, production database/toolchain validation, and jurisdiction/legal review remain open. The existing customer payment receipt is still only a settlement receipt and must not be relabeled as a tax invoice.

## Official requirements used by the contract

SF's initial Australian rules are based on Australian Taxation Office (ATO) and Australian Business Register (ABR) guidance reviewed on 4 September 2026:

- ATO tax-invoice guidance: https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
- ATO invoicing guidance for GST-registered businesses: https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/records-you-need-to-keep/invoices
- ABR ABN format/checksum guidance: https://abr.business.gov.au/Help/AbnFormat

The ATO guidance states that a tax invoice for a taxable sale under AUD 1,000 must clearly identify that it is intended to be a tax invoice, the seller and seller ABN, issue date, what was supplied including quantity/price where applicable, GST payable, and the extent to which supplies are taxable. For a sale of AUD 1,000 or more, buyer identity or buyer ABN is additionally required. The ATO also states that a GST-registered business should call its invoices `tax invoice`, while a business not registered for GST must not do so.

ABR guidance defines an ABN as an 11-digit identifier and publishes the modulus-89 checksum algorithm. SF implements that structural checksum locally. A structurally valid ABN is not proof that the entity is currently active or GST-registered.

## Initial supported content shape

The first Australian contract supports only a deliberately constrained hospitality case:

- issuer country is `AU`;
- booking currency is `AUD`;
- the issuer profile declares exactly one `ABN` registration for Australia;
- the issuer profile separately declares exactly one `GST` registration using that same ABN;
- the ABN passes the published 11-digit modulus-89 structural validation;
- accepted immutable pricing evidence contains exactly one `TAX` line with code `GST` and no other tax scheme;
- the persisted GST line equals the accepted booking tax total;
- persisted GST is exactly one-eleventh of the GST-inclusive booking total, limiting this first contract to fully taxable standard-GST supplies that can be represented without mixed taxable/GST-free allocation; and
- when the accepted total is AUD 1,000 or more, immutable recipient evidence supplies buyer identity or a valid buyer ABN.

The `GST` issuer registration is a tenant declaration. SF does not currently call ABN Lookup or the ATO to prove live GST registration status. That distinction must remain visible in product/legal documentation and future issuance review.

## Immutable preparation and recipient authority

`prepareHospitalityInvoice` requires `payment:manage`. It tenant-scopes the booking, accepted pricing evidence, current issuer profile, and booking customer, then freezes the exact legal/commercial evidence into a versioned preparation.

Preparation schema version 2 always contains an immutable recipient snapshot and recipient fingerprint. The default recipient is derived from the tenant-owned booking customer. A deliberate business-recipient path can instead freeze business legal name, address, email, and registrations such as an ABN. Later changes to customer/contact data do not silently rewrite the prepared recipient.

The browser cannot supply issuer identity, price totals, GST amount, pricing fingerprint, or recipient fingerprint as authority.

## Server-derived readiness boundary

`assessHospitalityAustralianTaxInvoiceReadiness` requires `payment:manage` and accepts only organization, actor, and immutable invoice-preparation identifiers. It resolves every dependency through the tenant boundary inside a serializable transaction.

The shared verification boundary reparses and checks the persisted preparation, recipient fingerprint, issuer profile/fingerprint, accepted pricing evidence/fingerprint, exact money, and booking ownership. It also rejects an unissued preparation when its money or pricing fingerprint no longer represents the booking's current accepted `CONFIRMED` or `CANCELLED` commercial state. An old preparation therefore cannot be numbered after a later price-changing booking modification.

The returned `contentReady` flag means only that the verified immutable evidence satisfies the narrow Australian content contract.

## Immutable issuance boundary

`issueHospitalityAustralianTaxInvoice` is an internal server service requiring `payment:manage`. The caller may identify the tenant-owned booking and preparation but cannot choose the jurisdiction, document type, number, sequence, issue time, issuer, recipient, tax lines, currency, or money.

Before first issuance the service reuses the same verified Australian readiness boundary. Only `contentReady` evidence can advance. The service then allocates the next tenant/jurisdiction/document-type sequence and creates the issued document in the **same serializable transaction**.

The initial document identity is `AU-TAX-########`, expanding beyond eight digits when required. This is an SF internal stable identity format, not an ATO-prescribed numbering presentation.

Database and service invariants include:

- one committed issued invoice per `(organizationId, preparationId)`;
- unique document number per organization and jurisdiction;
- unique sequence value per organization, jurisdiction, and document type;
- exact tenant/booking foreign-key binding back to the preparation and pricing evidence;
- immutable issue timestamp, issuer/recipient/pricing snapshots, exact money, and all source fingerprints;
- a SHA-256 fingerprint over canonical immutable issued evidence;
- retry-safe behavior: a repeated issuance request returns and revalidates the already-issued record instead of allocating another number; and
- safe audit evidence without recipient details or registration numbers.

Sequence allocation is transactional. If issuance fails or a serializable/unique-write race rolls back, the sequence mutation rolls back with it. The bounded retry path then rechecks whether another transaction already committed the preparation.

Once an issued record exists, retries return that immutable historical record even if the booking later changes. New commercial terms require new preparation/issuance or a future correction-document lifecycle; existing issued evidence is never silently rewritten.

## Customer document boundary

`listPublicBookingIssuedTaxInvoices` resolves the public organization by slug, verifies the encrypted booking capability against that organization, and independently verifies persisted booking ownership, the matching unexpired public principal, and the tenant-owned booking before returning issued documents. Queries remain scoped by organization, booking, jurisdiction, and document type.

Each persisted invoice is reparsed and checked against its immutable material columns and document fingerprint before a customer-safe document is derived. The public response excludes internal invoice IDs, preparation IDs, pricing-evidence IDs, issuer-profile IDs, sequence counters, user IDs, internal fingerprints, provider references, payment identifiers, and credentials.

The rendered customer document explicitly identifies itself as a `Tax invoice`, shows the issue date and stable document number, and derives seller, buyer, supply, GST, and total information only from the immutable issued snapshot. The browser Print/Save action prints only the selected invoice and does not create or mutate invoice authority.

## Remaining production boundaries

The Phase 12 invoice/tax-document checklist must remain open until the remaining production work is complete:

- richer persisted taxability semantics for mixed taxable, GST-free, input-taxed, exempt, and other legally distinct supplies where product scope requires them;
- credit-note/adjustment/correction/void/reissue semantics tied to refunds and commercial amendments without mutating an issued invoice;
- deterministic customer PDF artifact generation from the immutable issued snapshot; browser Print/Save is not that artifact authority;
- durable re-authenticated customer access beyond the current 24-hour recovery capability, including email delivery/resend and long-term document history;
- retention, accounting/export, and reconciliation requirements;
- production validation against the repository-required Node 24 toolchain and an explicitly disposable PostgreSQL target; and
- jurisdiction/legal review before SF represents the generated customer document as production-compliant.

## Validation

Dependency-free Australian contract tests cover the ABN checksum, normalization, invalid ABNs, buyer threshold behavior, GST declaration matching, currency restrictions, mixed-tax rejection, GST money reconciliation, and the narrow standard-GST invariant.

Issued-document domain tests cover explicit tax-invoice identity and issue date, number formatting, sequence/money serialization, number/sequence mismatch rejection, money reconciliation, required buyer identity, canonical fingerprint stability, evidence-change detection, and persisted snapshot reparsing.

The disposable PostgreSQL issuance suite covers authorization, cross-tenant denial, concurrent idempotent issuance, sequence uniqueness, stale commercial-state rejection without consuming a number, exact persisted money, and issuance audits. It must be executed only through the guarded database-test harness.

No GitHub Actions are used.
