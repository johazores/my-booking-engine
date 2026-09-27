# JSON request-body ingress policy

SF treats JSON request parsing as an explicit server resource boundary. Production write routes should not rely on an unbounded `request.json()` call when a domain-owned bounded reader can reject malformed or oversized input before business work begins.

## Implemented boundaries

Public hospitality booking requests and the authenticated hospitality routes listed in `docs/authenticated-hospitality-json-ingress.md` use bounded readers. The authenticated hospitality reader enforces:

- `application/json`;
- strict UTF-8 decoding;
- an advertised `Content-Length` ceiling when present;
- an independent streamed byte ceiling;
- object-only JSON payloads; and
- normalized fail-closed request errors before service execution.

These transport checks do not replace authentication, same-origin protection, active-tenant resolution, permissions, resource ownership, idempotency, locks, provider truth, settlement authority, or audit behavior.

## Reviewed remaining gaps

The source contract currently permits raw `request.json()` only at seven reviewed authenticated routes:

- commercial-amendment manual settlement;
- commercial-amendment Stripe refund execution;
- generic manual payment;
- generic manual refund;
- generic Stripe refund;
- generic Stripe payment reconciliation;
- generic Stripe refund reconciliation.

These are implementation gaps, not approved permanent exceptions. They remain protected by their existing authentication, same-origin, tenant, authorization, service-validation, idempotency, and provider boundaries while their transport parsing is brought onto dedicated bounded readers.

Stripe webhook ingestion is intentionally outside this JSON-parser inventory because signature verification requires the exact raw request body.

## Regression rule

`scripts/json-request-ingress-inventory-contract.test.mjs` scans the production API route tree and requires the raw-parser inventory to equal the reviewed list above. A new raw JSON parser call therefore fails the source contract instead of silently expanding the exception set.

The intended end state is an empty reviewed raw-parser list for normal JSON API routes, with raw-body cryptographic callback boundaries documented separately.

Full repository validation still requires the repository Node 24.20+ toolchain and the disposable PostgreSQL gates. GitHub Actions are intentionally not used.
