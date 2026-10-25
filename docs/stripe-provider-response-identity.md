# Stripe provider response identity and settlement evidence

## Scope

Stripe HTTP transport policy protects credentialed request routing and framing. This separate adapter-level boundary verifies that the provider object returned by a successful HTTP response is the object SF actually requested, and that successful payment states carry received-money evidence. Neither HTTP 200 nor a well-formed provider object is sufficient on its own to settle a booking or refund.

## Writes

- A PaymentIntent capture response must have the exact requested PaymentIntent ID. An authorization release response has the same exact-ID requirement; padded or normalized substitutes are not accepted.
- A refund creation response must contain the exact source PaymentIntent ID requested by SF and a syntactically valid real `re_*` refund ID. A refund for another PaymentIntent, or an unrecognized reference, cannot become refund settlement evidence.
- An authorization response reporting `succeeded` must explicitly report `amount_received` equal to the expected amount. A capture response reporting `succeeded` must explicitly report the captured amount; SF does not infer received money from its own requested amount. Other payment states preserve existing pending/authorization semantics.

## Provider-truth reads

- PaymentIntent reconciliation compares the returned PaymentIntent ID with the exact requested ID before producing a snapshot. Received and capturable amounts must be safe, non-negative integer minor units no greater than the PaymentIntent amount.
- Refund reconciliation compares the returned Refund ID with the exact requested ID before producing a snapshot. Existing refund source, status, currency, and positive-money checks remain in place.
- The application reconciliation services also recheck identity, tenant-owned payment/refund records, source attribution, amounts, and persisted booking state under the existing transaction/lock boundaries.

A mismatch is a retryable `UNKNOWN` provider-evidence failure. It must not be mistaken for a customer decline, a definitive failed payment, or permission to create a new commercial operation with another idempotency key. Existing durable pending/ambiguous claims remain subject to exact retry, provider-truth reconciliation, and verified webhook recovery.

## Validation

Focused tests cover substituted capture/refund IDs, refund source substitution, invalid refund IDs, missing or mismatched received-money evidence, substituted reconciliation IDs, and impossible received/capturable amounts. The full repository Node 24 / TypeScript 6 / Prisma / PostgreSQL / build validation and live Stripe integration remain separate environment gates. No GitHub Actions are used.
