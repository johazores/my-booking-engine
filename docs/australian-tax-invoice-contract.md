# Australian tax-invoice contract

## Status

Australia is SF's first explicit regulated hospitality invoice jurisdiction. The implementation is intentionally narrow and fail-closed.

Current server/document authorities include immutable invoice preparation, Australian readiness, serializable tax-invoice numbering/issuance, authenticated and capability-owned customer history, deterministic PDF projection for supported text, tenant accounting export, legal-document reconciliation/retention policy, schema-version-1 full cancellation, direction-aware cumulative commercial adjustments across schemas 2 through 5, and one terminal schema-version-6 full cancellation after a verified commercial chain.

The generated customer tax invoice identifies itself as `Tax invoice` and derives issue date/number, seller/buyer, applicable ABNs, supply lines, GST, and total only from immutable issued evidence. The payment receipt remains separate settlement evidence.

The Phase 12 jurisdiction lifecycle is not production-complete yet: mixed/partial/non-standard-GST corrections, generic correction/void/reissue, durable customer re-authentication and email/resend, universal Unicode-safe PDF font coverage, a reviewed disposal/de-identification lifecycle, live Node 24/PostgreSQL validation, and legal review remain open.

## Official requirements used by the contract

The Australian rules were reviewed against Australian Taxation Office (ATO) tax-invoice guidance and Australian Business Register (ABR) ABN-format guidance on 4 September 2026:

- ATO tax invoices: https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
- ATO invoicing/records: https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/records-you-need-to-keep/invoices
- ABR ABN format/checksum: https://abr.business.gov.au/Help/AbnFormat

Increasing-adjustment readiness/persistence was additionally reviewed against ATO GSTR 2013/2 on 5 September 2026; see `docs/australian-commercial-amendment-increasing-adjustment-readiness.md`. Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

## Initial supported content shape

The current narrow contract supports:

- AU issuer and AUD booking;
- exactly one AU `ABN` registration and one `GST` declaration using that same structurally valid ABN;
- exactly one persisted `GST` tax line and no other tax scheme;
- persisted GST equal to accepted booking tax total;
- GST exactly one-eleventh of the GST-inclusive accepted total, limiting this contract to fully taxable standard-GST supplies; and
- immutable buyer identity or valid buyer ABN when the accepted total is AUD 1,000 or more.

The `GST` registration remains a tenant declaration. SF does not currently call ABN Lookup or the ATO to prove live GST registration.

## Preparation and immutable issuance

`prepareHospitalityInvoice` requires `payment:manage`, tenant-scopes booking/pricing/issuer/customer evidence, and freezes exact legal/commercial evidence into versioned preparation. `assessHospitalityAustralianTaxInvoiceReadiness` reparses and verifies preparation/recipient/issuer/pricing fingerprints, exact money, booking ownership, and current accepted commercial state.

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, reuses verified readiness, allocates the next tenant/jurisdiction/document sequence, and creates immutable `HospitalityIssuedInvoice` evidence in the same serializable transaction. The browser cannot supply ABN, GST, recipient identity, totals, tax lines, sequence, or fingerprints as authority.

## Adjustment lifecycle

Schema version 1 is the full-cancellation adjustment for an unadjusted source invoice. Commercial schemas 2 through 5 support first/repeated decreasing and increasing adjustments from a complete verified legal chain head. Schema version 6 is one terminal full cancellation after commercial amendments; its before-price is the verified current commercial after-price and its after-price is zero.

Schema-version-6 readiness re-proves provider-neutral settlement at the commercial head and requires the issue-time refund set to reduce settlement exactly to zero. Its writer derives refund IDs, legal money/GST, ordinal, predecessor, numbering, fingerprints, and issue time server-side under the same source-chain serialization boundary.

## Customer/read boundary

Authenticated document/history/register reads require both `booking:read` and `payment:read`; issuance remains `payment:manage`. Public history verifies organization slug, encrypted booking capability, persisted booking ownership, matching unexpired public principal, and tenant-owned booking before querying legal documents.

Public JSON excludes internal invoice/preparation/pricing/issuer IDs, predecessor/amendment/target IDs, sequence counters, user IDs, fingerprints, provider/payment/refund references, and credentials unless legally required.

The current public capability is still the booking-recovery capability, not a durable customer identity or permanent document link.

## Deterministic PDF boundary

`src/server/payments/hospitality-tax-invoice-pdf-domain.ts` and the adjustment-note PDF domain generate deterministic PDF bytes only from verified customer documents. Exact AUD values use integer minor units and large documents paginate without truncation. Unsupported legal text fails closed under the current font encoding contract.

Authenticated PDF download re-enters verified issued-document authorization. Public PDF download is same-origin and retains booking capability authorization.

Universal Unicode-safe embedded-font rendering remains open.

## Accounting, retention, and reconciliation boundary

Tenant invoice and adjustment registers use shared server-side immutable evidence validation before accounting CSV, reconciliation, HTML, or PDF projection. Schema-version-6 cancellation is accepted only after the complete commercial predecessor chain and frozen issue-time refund authority are independently reverified.

`/invoices/reconciliation` performs a bounded tenant-scoped point-in-time integrity review and rejects concurrent register changes. `docs/tax-document-retention-and-reconciliation.md` defines the no-automatic-disposal rule and the separate future tax/privacy/legal authority required before disposal or de-identification.

## Remaining production boundaries

The master invoice/tax-document item remains open for:

- mixed taxable/GST-free/input-taxed/exempt, partial-refund, and non-standard-GST semantics when product scope requires them;
- generic credit/correction/void/reissue semantics without mutating issued evidence;
- universal Unicode-safe deterministic PDF rendering;
- durable re-authenticated customer history plus email delivery/resend;
- a reviewed customer-data disposal/de-identification lifecycle and any future accounting-provider integration;
- repository-required Node 24 and disposable PostgreSQL validation; and
- jurisdiction/legal review before SF represents the workflow as production-compliant for all supported Australian cases.

## Validation

Dependency-free tests cover Australian ABN/readiness rules, issued-document identity/fingerprints, cumulative mixed-direction commercial adjustment chains, terminal cancellation readiness/evidence/read authority/writer/product boundaries, deterministic PDF behavior, and retention/reconciliation contracts. Disposable PostgreSQL suites remain required for live authorization, cross-tenant denial, issuance idempotency/sequence uniqueness, constraints, concurrency, stale-state rejection, persisted money, and audits.

GitHub Actions are not used.
