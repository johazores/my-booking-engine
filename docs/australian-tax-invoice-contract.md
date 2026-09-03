# Australian tax-invoice contract

## Status

Australia is the first explicit jurisdiction contract for SF's future regulated hospitality invoice workflow. This contract is intentionally narrow and fail-closed. It defines content/readiness rules only; it does **not** issue a legal tax invoice yet.

The existing customer payment receipt remains a settlement receipt. It must not be relabeled as an Australian tax invoice.

## Official requirements used by the contract

SF's initial Australian rules are based on current Australian Taxation Office (ATO) and Australian Business Register (ABR) guidance reviewed on 4 September 2026:

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
- when the accepted total is AUD 1,000 or more, a tenant-owned buyer identity is available.

The `GST` issuer registration is a tenant declaration. SF does not currently call ABN Lookup or the ATO to prove live GST registration status. That distinction must remain visible in product/legal documentation and future issuance review.

## Server-derived readiness boundary

`assessHospitalityAustralianTaxInvoiceReadiness` requires `payment:manage` and accepts only organization, actor, and immutable invoice-preparation identifiers. It resolves the preparation, booking/customer, issuer profile, and accepted pricing evidence through the tenant boundary inside one serializable read transaction.

The service reparses and checks the persisted invoice preparation, issuer fingerprint, pricing-evidence fingerprint, currency, tax money, total money, and resource ownership before applying the Australian rules. Buyer identity is derived from the tenant-owned booking customer; callers cannot supply buyer identity, ABN, GST amount, totals, or tax lines as authority.

The returned `contentReady` flag means only that the immutable evidence satisfies this narrow Australian content contract. It is **not** authorization to issue a legal document and must not be exposed as a customer-visible tax invoice success state.

## What still blocks issuance

Even when `contentReady` is true, SF must not issue or label a document as an Australian tax invoice until these production authorities exist:

- an immutable invoice-recipient/billing snapshot captured at issuance preparation, including a deliberate business-recipient/ABN path instead of assuming every customer is an individual;
- explicit persisted taxability semantics capable of representing mixed taxable, GST-free, input-taxed, exempt, and other legally distinct supplies where product scope requires them;
- a tenant/jurisdiction/document-type fiscal numbering sequence with concurrency-safe uniqueness;
- an immutable issued-document state with issue timestamp and no silent mutation after issuance;
- credit-note/correction/void/reissue semantics tied to refunds and commercial amendments;
- deterministic rendering/PDF from immutable issued evidence;
- authenticated/public-safe access plus email/delivery/resend/history rules;
- retention and accounting/export requirements; and
- production validation against the repository Node 24 and disposable PostgreSQL gates.

## Validation

Dependency-free tests cover the published ABN checksum, normalization, invalid ABNs, Australian threshold behavior, GST declaration matching, currency restrictions, mixed-tax rejection, GST money reconciliation, and the narrow standard-GST invariant.

The server readiness service is intentionally internal and has no public/customer route or primary action. No GitHub Actions are used.
