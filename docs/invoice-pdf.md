# Deterministic Australian tax-document PDFs

## Status

SF can generate deterministic A4 PDF copies of verified issued Australian hospitality tax invoices and both currently supported first decreasing-adjustment notes: full booking cancellation and one applied commercial booking amendment. PDF generation is a read projection only: it never creates, renumbers, corrects, or mutates legal-document authority.

The tax-invoice renderer consumes the customer-safe document derived from immutable `HospitalityIssuedInvoice.documentSnapshot` evidence after material-column, fingerprint, issuer, recipient, pricing, Australian GST, and total checks have passed.

The adjustment-note renderer consumes the customer-safe document derived from immutable `HospitalityIssuedAdjustmentNote.documentSnapshot` evidence after material-column, fingerprint, issuer/recipient, complete source-tax-invoice, reason-specific authority, and exact decrease checks have passed.

## Server boundaries

Authenticated tax-invoice download is exposed through `GET /api/invoices/hospitality/[document-number]/pdf`. Authenticated adjustment-note download is exposed through `GET /api/invoices/hospitality/adjustments/[document-number]/pdf`.

Both routes re-enter their existing issued-document read services, so `booking:read` and `payment:read`, active organization membership, tenant scope, document-number scope, and persisted evidence integrity are enforced server-side before any bytes are generated. The adjustment-note route uses the generic verified adjustment read boundary and therefore supports cancellation and commercial-amendment documents without bypassing their reason-specific authority checks. The browser cannot supply seller, buyer, ABN, GST, prices, totals, issue dates, source invoice identity, reason, or document number as PDF authority.

Customer tax-invoice download is exposed through `POST /api/public-bookings/[organization-slug]/hospitality/tax-invoices/[document-number]/pdf`. Customer adjustment-note download is exposed through `POST /api/public-bookings/[organization-slug]/hospitality/adjustment-notes/[document-number]/pdf`. Both keep the booking capability out of URLs, require the same-origin public-booking policy, and reuse capability-owned tax-document history, which independently verifies organization slug, encrypted booking capability, persisted booking ownership, the unexpired matching public principal, tenant-owned booking, immutable document evidence, and adjustment-note source/reason-specific authority.

Both authenticated and public routes use `no-store`, `application/pdf`, `nosniff`, and attachment disposition. Authorization failures remain generic and do not reveal whether another tenant's document exists.

## Deterministic rendering contract

`src/server/payments/hospitality-tax-invoice-pdf-domain.ts` owns tax-invoice PDF generation. `src/server/payments/hospitality-adjustment-note-pdf-domain.ts` owns adjustment-note PDF generation. For the same verified customer document each renderer produces byte-for-byte identical output:

- no current-clock value, random identifier, mutable branding record, external provider response, or runtime metadata enters the PDF;
- immutable issued timestamps are the only legal date authority;
- A4 dimensions, layout, object numbering, page ordering, fonts, and page composition are fixed;
- exact AUD minor-unit strings are converted without floating-point arithmetic;
- legal identity, document/source-document numbers, GST values, totals, and adjustment effects come only from verified issued evidence; and
- the tax-invoice renderer paginates large supply sets deterministically rather than truncating them.

The adjustment-note renderer validates the reason-specific price effect before rendering. Booking cancellation requires `price before = total decrease` and `price after = 0`. A commercial booking amendment requires `price before > price after` and `price before - price after = total decrease`. Each reason receives its own immutable explanatory text in the generated artifact.

The current renderers use the PDF standard Helvetica/Helvetica Bold fonts with WinAnsi encoding. Printable ASCII, Latin-1, and the defined Windows-1252 punctuation set are supported. If legal text cannot be represented losslessly, generation fails closed; SF does not transliterate, replace, or silently corrupt names or addresses. Browser Print/Save remains available as a convenience fallback, but it is not deterministic artifact authority.

Broader Unicode-safe PDF font embedding remains required before deterministic PDF delivery can be considered universal for every possible Australian recipient/issuer name.

## Product surfaces

Authenticated tax-invoice and adjustment-note detail pages expose both **Download PDF** and **Print or save copy** for all currently supported document reasons.

The public booking tax-document history exposes **Download PDF** for each visible verified invoice and adjustment note, including commercial-amendment notes. Download actions have busy/disabled states, keep the booking capability in the request body, download the response as a local file, and surface a specific safe error when legal text cannot be represented losslessly by the current PDF contract.

## Validation

Dependency-free tax-invoice renderer tests cover byte-for-byte determinism, PDF identity/object structure, multi-page output, lossless Windows-1252 handling, unsupported-script rejection, AUD-only scope, and exact total reconciliation.

Dependency-free adjustment-note renderer tests cover byte-for-byte determinism for both current adjustment reasons, source-document identity, unsupported-script rejection, AUD-only scope, exact decrease reconciliation, cancellation and commercial-amendment before/after price semantics, unknown-reason rejection, and source-document chronology.

A generated commercial-amendment adjustment-note fixture was parsed with local `pdfinfo` and reported PDF 1.4, one A4 page, unencrypted, with no JavaScript.

Full repository Node 24 typecheck/lint/test/build, Prisma checks, and PostgreSQL integration validation require the repository-supported Node 24 dependency checkout and an explicitly disposable database. GitHub Actions are not used.
