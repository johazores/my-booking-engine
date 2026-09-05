# Legal-document delivery request observability

## Scope

SF applies bounded request correlation to the current Australian hospitality legal-document delivery and reconciliation boundaries where operators need to connect an HTTP outcome to one privacy-safe completion record. This layer is operational telemetry only. It does not create legal authority, replace immutable audit evidence, or change tenant/customer authorization.

Reviewed operations are:

- `hospitality-tax-invoice.pdf.download`
- `hospitality-adjustment-note.pdf.download`
- `hospitality-tax-invoice.accounting-export`
- `hospitality-adjustment-note.accounting-export`
- `public-booking.tax-document-history.read`
- `public-booking.tax-invoice.pdf.download`
- `public-booking.adjustment-note.pdf.download`
- `hospitality-tax-document.reconciliation.run`

Every instrumented response carries the bounded `x-request-id` selected by `src/server/observability/request-observability.ts`, including PDF/CSV success responses, validation/authorization rejection, export limits, evidence failures, renderer failures, and reconciliation redirect outcomes.

## Authenticated authority boundary

Authenticated PDF and accounting-export routes create correlation before authentication so failures can still be traced, but `organizationId` is added to log scope only after `requireHospitalityBookingApiContext` has established the authenticated active tenant. Existing issued-document read services remain responsible for `booking:read`, `payment:read`, tenant/document scope, immutable evidence verification, adjustment-chain authority, and export limits.

Document numbers, source-document numbers, booking IDs/references, customer details, issuer/recipient details, prices, GST, fingerprints, CSV contents, PDF bytes, URLs, and raw errors are not copied into request-log scope. `documentType` is the static reviewed label `tax-invoice` or `adjustment-note`; it is not inferred from browser input.

## Public customer boundary

Public tax-document history and PDF delivery remain capability-owned. Request logging never receives organization slug, booking capability, document number, customer/contact data, legal-document evidence, request body, or route URL. A public request therefore cannot cause tenant or document identifiers to appear in structured request logs before or after capability verification.

`src/server/payments/public-tax-document-http.ts` owns the small JSON transport parser shared by the public history and PDF routes. Malformed JSON, arrays, null bodies, and non-string `bookingCapability` values now fail closed as `400 invalid-request` instead of falling through to a generic server error. The capability value is returned only to the existing authorization service and is never used as correlation metadata.

## Reconciliation boundary

The operator-triggered reconciliation POST is correlated separately from the durable reconciliation `AuditEvent`. Tenant scope is attached only after the authenticated hospitality context succeeds. Because the form workflow returns HTTP 303 redirects, expected permission/request/limit failures are logged with the shared logical `rejected` outcome and unexpected server failures with logical `failed`; a redirect status is never treated as proof that reconciliation itself succeeded.

Unexpected reconciliation failures now redirect to an explicit `error=internal` UI state instead of escaping without a correlated completion record. No successful reconciliation result is fabricated or recorded for that path.

## Validation

- `src/server/payments/public-tax-document-http.test.ts` covers valid capability extraction plus malformed JSON and unsupported body shapes.
- `scripts/legal-document-delivery-request-observability.test.mjs` covers all current authenticated PDF/accounting routes, public tax-document history/PDF routes, authority ordering, tenant/capability/document-data exclusion, malformed-body fail-closed behavior, and reconciliation redirect outcome classification.
- TypeScript route/helper syntax is checked with the locally available Node TypeScript stripping parser where supported. TSX parsing and the full repository Node 24 typecheck/lint/test/build remain part of the normal repository validation gate.

This work does not change the Prisma schema or migration chain and does not use GitHub Actions.
