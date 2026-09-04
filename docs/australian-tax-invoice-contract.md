# Australian tax-invoice contract

## Status

Australia is SF's first explicit regulated hospitality invoice jurisdiction. The implementation is intentionally narrow and fail-closed.

Current server/document authorities are:

1. immutable invoice preparation with frozen individual/business recipient evidence;
2. Australian content/readiness assessment over frozen issuer, recipient, and accepted pricing evidence;
3. concurrency-safe immutable tax-invoice numbering and issuance;
4. authenticated and capability-owned customer rendering/history;
5. deterministic server-side PDF projection for legal text that is losslessly representable by the current PDF font contract;
6. tenant-wide paginated register plus bounded accounting CSV export; and
7. tenant-scoped live legal-document integrity reconciliation with an explicit no-automatic-disposal retention rule.

The generated customer document identifies itself as `Tax invoice` and derives issue date/number, seller/buyer, applicable ABNs, supply lines, GST, and total only from immutable issued evidence. The payment receipt remains separate settlement evidence.

The Phase 12 jurisdiction lifecycle is not production-complete yet: broader partial/multiple/commercial-amendment adjustment/correction contracts, durable customer re-authentication and email/resend, universal Unicode-safe PDF font coverage, a reviewed disposal/de-identification lifecycle, live Node 24/PostgreSQL validation, and legal review remain open.

## Official requirements used by the contract

The Australian rules were reviewed against Australian Taxation Office (ATO) tax-invoice guidance and Australian Business Register (ABR) ABN-format guidance on 4 September 2026:

- ATO tax invoices: https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
- ATO invoicing/records: https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/records-you-need-to-keep/invoices
- ABR ABN format/checksum: https://abr.business.gov.au/Help/AbnFormat

The contract requires explicit tax-invoice identity, seller and seller ABN, issue date, supplied items/quantity/price where applicable, GST payable, and taxable extent. At AUD 1,000 or more it additionally requires buyer identity or buyer ABN. ABN structural validation follows the published 11-digit modulus-89 algorithm. A structurally valid ABN is not proof of live registration or GST status.

## Initial supported content shape

The first contract supports only:

- AU issuer and AUD booking;
- exactly one AU `ABN` registration and one `GST` declaration using that same structurally valid ABN;
- exactly one persisted `GST` tax line and no other tax scheme;
- persisted GST equal to accepted booking tax total;
- GST exactly one-eleventh of the GST-inclusive accepted total, limiting this contract to fully taxable standard-GST supplies; and
- immutable buyer identity or valid buyer ABN when the accepted total is AUD 1,000 or more.

The `GST` registration remains a tenant declaration. SF does not currently call ABN Lookup or the ATO to prove live GST registration.

## Preparation and readiness authority

`prepareHospitalityInvoice` requires `payment:manage`, tenant-scopes booking/pricing/issuer/customer evidence, and freezes exact legal/commercial evidence into versioned preparation. Preparation schema version 2 contains an immutable recipient snapshot and fingerprint; business-recipient capture can freeze legal name, address, email, and registrations such as ABN.

`assessHospitalityAustralianTaxInvoiceReadiness` also requires `payment:manage`. It resolves all dependencies through the active tenant boundary in a serializable read, reparses and verifies preparation/recipient/issuer/pricing fingerprints, exact money, booking ownership, and current accepted commercial state. The browser cannot supply ABN, GST, recipient identity, currency, totals, tax lines, or fingerprints as authority.

## Immutable issuance

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`. It reuses verified readiness, then allocates the next tenant/jurisdiction/document-type sequence and creates `HospitalityIssuedInvoice` in the same serializable transaction.

The initial stable identity is `AU-TAX-########` and expands beyond eight digits when required. It is an SF identity format, not an ATO-prescribed presentation.

Service/database invariants include one issued invoice per preparation, unique tenant/jurisdiction number and sequence, exact composite tenant/booking linkage, immutable issue/party/pricing/money evidence, canonical SHA-256 document fingerprinting, retry-safe issuance, and secret/PII-safe auditing. Existing issued evidence is never rewritten after later booking changes.

## Customer/read boundary

Authenticated document/history/register reads require both `booking:read` and `payment:read`; issuance remains `payment:manage`. Tenant and booking ownership are independently revalidated server-side.

Public history verifies organization slug, encrypted booking capability, persisted booking ownership, matching unexpired public principal, and tenant-owned booking before querying organization+booking+jurisdiction+document-type scoped invoice records. Returned JSON excludes internal invoice/preparation/pricing/issuer IDs, sequence counters, user IDs, fingerprints, provider/payment references, and credentials.

The current public capability is still the booking-recovery capability (24 hours from public confirmation), not a durable customer identity or permanent document link.

## Deterministic PDF boundary

`src/server/payments/hospitality-tax-invoice-pdf-domain.ts` generates A4 PDF 1.4 bytes only from the verified customer document. It uses no current clock, random value, mutable provider/tenant data, or runtime metadata; identical verified input produces identical bytes. Exact AUD values use integer minor units, and large invoices paginate without truncation.

Authenticated PDF download re-enters issued-invoice read authorization. Public PDF download is same-origin POST and keeps the booking capability in the request body.

The renderer currently uses standard PDF Helvetica fonts with WinAnsi encoding. Printable ASCII, Latin-1, and defined Windows-1252 punctuation are rendered losslessly. Unsupported legal text fails closed with no substitution or transliteration. Browser Print/Save remains available but is not PDF artifact authority. Universal Unicode-safe embedded-font rendering remains open.

## Accounting, retention, and reconciliation boundary

`/invoices` is a tenant-wide paginated register. The accounting CSV is server-generated only after each row passes persisted snapshot/material-column/fingerprint validation, contains exact invoice-number/date/booking/currency/accommodation/fee/add-on/GST/total fields, excludes secrets/payment-provider data, and is capped at 5,000 rows so the synchronous route never returns an unbounded or partial export.

`/invoices/reconciliation` performs a tenant-scoped point-in-time integrity review over the current AU invoice and adjustment-note registers. It reuses the same immutable evidence validators, revalidates adjustment-note source invoice linkage, rejects concurrent register changes, and fails closed above 5,000 combined documents. `docs/tax-document-retention-and-reconciliation.md` defines the current no-automatic-disposal rule and the separate future tax/privacy/legal authority required before disposal or de-identification.

## Remaining production boundaries

The master invoice/tax-document item remains open for:

- mixed taxable/GST-free/input-taxed/exempt semantics when product scope requires them;
- broader partial-refund, multiple-refund, commercial-amendment, credit/correction/void/reissue semantics without mutating issued evidence;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history beyond the 24-hour recovery capability, plus email delivery/resend;
- a reviewed customer-data disposal/de-identification lifecycle and any future accounting-provider integration;
- repository-required Node 24 and disposable PostgreSQL validation; and
- jurisdiction/legal review before SF represents the workflow as production-compliant for all supported Australian cases.

## Validation

Dependency-free tests cover Australian ABN/readiness rules, issued-document identity/fingerprints, deterministic PDF behavior including pagination and fail-closed unsupported text, and the retention/reconciliation result contract. The disposable PostgreSQL suites cover authorization, cross-tenant denial, issuance idempotency/sequence uniqueness, stale-state rejection, persisted money, and audits when executed through the guarded database harness.

GitHub Actions are not used.
