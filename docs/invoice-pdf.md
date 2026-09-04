# Deterministic tax-invoice PDF

## Status

SF can generate a deterministic A4 PDF copy of a verified issued Australian hospitality tax invoice. The PDF is a read projection only: it never creates, renumbers, corrects, or mutates invoice authority.

The renderer consumes the customer-safe document derived from immutable `HospitalityIssuedInvoice.documentSnapshot` evidence after the existing material-column, fingerprint, issuer, recipient, pricing, Australian GST, and total checks have passed.

## Server boundaries

Authenticated download is exposed through `GET /api/invoices/hospitality/[document-number]/pdf`.

The route re-enters the existing issued-invoice read service, so both `booking:read` and `payment:read`, active organization membership, tenant scope, document-number scope, and persisted evidence integrity are enforced server-side before any bytes are generated. The browser cannot supply seller, buyer, ABN, GST, prices, totals, issue date, or invoice number as PDF authority.

Customer download is exposed through `POST /api/public-bookings/[organization-slug]/hospitality/tax-invoices/[document-number]/pdf` because the booking capability is intentionally kept out of URLs. The route requires the same-origin public-booking policy and reuses the capability-owned issued-invoice history boundary, which independently verifies organization slug, encrypted booking capability, persisted booking ownership, the unexpired matching public principal, tenant-owned booking, and immutable invoice evidence. A customer can download only an invoice present in the currently exposed recent-document set for that booking.

Both routes use `no-store`, `application/pdf`, `nosniff`, and attachment disposition. Authorization failures remain generic and do not reveal whether another tenant's document exists.

## Deterministic rendering contract

`src/server/payments/hospitality-tax-invoice-pdf-domain.ts` owns PDF generation. For the same verified customer document it produces byte-for-byte identical output:

- no current-clock value, random identifier, mutable branding record, external provider response, or runtime metadata enters the PDF;
- the immutable issued timestamp is the only document date authority;
- A4 dimensions, layout, object numbering, page ordering, fonts, and pagination rules are fixed;
- exact AUD minor-unit strings are converted without floating-point arithmetic;
- invoice number, supplier/buyer identities, ABNs, supply lines, GST, and totals come only from verified issued evidence; and
- large invoices paginate deterministically rather than truncating supply lines.

The current renderer uses the PDF standard Helvetica/Helvetica Bold fonts with WinAnsi encoding. It supports printable ASCII, Latin-1, and the defined Windows-1252 punctuation set. If any legal text cannot be represented losslessly, generation fails closed with `invoice-pdf-unavailable`; SF does not transliterate, replace, or silently corrupt names/addresses. Browser Print/Save remains available as a convenience fallback, but it is not the deterministic artifact authority.

Broader Unicode-safe PDF font embedding is still required before deterministic PDF delivery can be considered universal for every possible Australian recipient/issuer name.

## Product surfaces

Authenticated invoice detail exposes both **Download PDF** and the existing browser **Print or save copy** action.

The public booking invoice history exposes **Download PDF** for each visible verified invoice. The button has a busy/disabled state, keeps the booking capability in the request body, downloads the response as a local file, and surfaces a specific safe error when the current renderer cannot represent legal text losslessly.

## Validation

Dependency-free renderer tests cover byte-for-byte determinism, PDF identity/object structure, multi-page output, lossless Windows-1252 handling, unsupported-script rejection, AUD-only scope, and exact total reconciliation.

During implementation the generated fixture was also parsed with local `pdfinfo`, which reported a valid PDF 1.4, A4 page, and the expected page count.

Full repository Node 24 typecheck/lint/test/build, Prisma checks, and PostgreSQL integration validation require the repository-supported Node 24 dependency checkout and an explicitly disposable database. GitHub Actions are not used.
