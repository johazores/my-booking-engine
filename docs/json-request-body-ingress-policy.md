# JSON request-body ingress policy

SF treats JSON request parsing as an explicit server resource boundary. Production write routes should use a domain-owned bounded reader so malformed or oversized input is rejected before business work begins.

## Implemented boundaries

Public hospitality booking requests and the authenticated hospitality routes listed in `docs/authenticated-hospitality-json-ingress.md` use bounded readers. The authenticated hospitality reader enforces:

- `application/json`;
- strict UTF-8 decoding;
- an advertised `Content-Length` ceiling when present;
- an independent streamed byte ceiling;
- object-only JSON payloads; and
- normalized fail-closed request errors before service execution.

Generic authenticated payment APIs use `readPaymentJsonObject()` with the same transport checks and a 64 KiB default ceiling. The manual payment/refund and Stripe refund/reconciliation routes all pass through that reader.

These transport checks do not replace authentication, same-origin protection, active-tenant resolution, permissions, resource ownership, idempotency, locks, provider truth, settlement authority, or audit behavior.

## Raw JSON parser inventory

No normal production API route currently uses raw `request.json()`.

Stripe webhook ingestion remains separate because signature verification requires the exact raw request body. Its raw-body contract is documented in `docs/stripe-webhook-write-scope.md`.

## Regression rule

`scripts/json-request-ingress-inventory-contract.test.mjs` scans the production API route tree and requires the raw-parser inventory to remain empty.

`src/server/payments/payment-http.test.ts` covers the payment reader's object-only parsing, media type, strict UTF-8, and byte-limit behavior.

Full repository validation still requires the repository Node 24.20+ toolchain and the disposable PostgreSQL gates. GitHub Actions are intentionally not used.
