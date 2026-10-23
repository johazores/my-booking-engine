# Legal-document register navigation safety

The authenticated Australian tax-invoice register, booking-specific invoice history, adjustment-note register, and reconciliation-history page share `parseHospitalityLegalDocumentPage`. Next.js query parameters are untrusted: repeated `page` keys can arrive as arrays, while JavaScript number coercion accepts hexadecimal, exponent, whitespace, and other non-decimal spellings. These are not valid SF register page requests.

The shared browser-query boundary accepts only one ASCII decimal page string, at most six digits and between 1 and 100,000 inclusive. Missing, repeated, malformed, zero, or out-of-range values safely display page 1 rather than throwing in the server-rendered page. This does not replace the independently enforced numeric page/page-size bounds in the tenant-scoped read services.

When a valid requested page exceeds the current tenant-scoped count, the register redirects to the last available page. Navigation is based on the original requested page, not the already-clamped service result. The count, clamped page, and rows remain read inside each existing PostgreSQL `RepeatableRead` snapshot. No authorization, legal-document issuance, reconciliation, or payment authority changes.

The reconciliation result banner only reads own keys of its predefined error-message map. Untrusted `error=__proto__` or `error=constructor` must never render an inherited object as React content. The query parameter is presentation-only and cannot trigger a reconciliation run.

The pure parser has Node test coverage in `src/server/payments/hospitality-legal-document-page-query.test.ts`. Full repository Node 24/Prisma/PostgreSQL validation is still required before claiming production readiness.
