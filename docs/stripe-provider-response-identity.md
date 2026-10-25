# Stripe provider response identity and settlement evidence

## Scope

Stripe HTTP transport policy protects credentialed request routing and framing. This separate adapter-level boundary verifies that the provider object returned by a successful HTTP response is the object SF actually requested, and that successful payment states carry received-money evidence. Neither HTTP 200 nor a well-formed provider object is sufficient on its own to settle a booking or refund.

## Writes

- A PaymentIntent capture response must have the exact requested PaymentIntent ID. An authorization release response has the same exact-ID requirement; padded or normalized substitutes are not accepted.
- A refund creation response must contain the exact source PaymentIntent ID requested by SF and a syntactically valid real `re_*` refund ID. A refund for another PaymentIntent, or an unrecognized reference, cannot become refund settlement evidence.
- A manual-capture authorization reporting `requires_capture` must prove the full requested amount in Stripe's explicit `amount_capturable` field, with zero `amount_received`. Missing, partial, excessive, or inconsistent evidence is retryable unknown provider truth, not an `AUTHORIZED` ledger state. Stripe capture limits are based on `amount_capturable`, not on the PaymentIntent's nominal `amount`.
- An authorization response reporting `succeeded` must explicitly report `amount_received` equal to the expected amount. A capture response reporting `succeeded` must explicitly report the captured amount; SF does not infer received money from its own requested amount. Other payment states preserve existing pending/authorization semantics.

## Provider-truth reads

- Pending-authorization reconciliation requires explicit `amount_received` and `amount_capturable` provider fields and accepts `requires_capture` as authorized only when the entire persisted amount is still capturable and no funds have been received. Signed PaymentIntent webhooks preserve the actual capturable amount; they never synthesize it from nominal minus received money. Invalid webhook evidence is rejected before durable mutation, while a valid partial amount fails closed at reconciliation.
- PaymentIntent reconciliation compares the returned PaymentIntent ID with the exact requested ID before producing a snapshot. Received and capturable amounts must be safe, non-negative integer minor units no greater than the PaymentIntent amount.
- Refund reconciliation compares the returned Refund ID with the exact requested ID before producing a snapshot. Existing refund source, status, currency, and positive-money checks remain in place.
- The application reconciliation services also recheck identity, tenant-owned payment/refund records, source attribution, amounts, and persisted booking state under the existing transaction/lock boundaries.

A mismatch is a retryable `UNKNOWN` provider-evidence failure. It must not be mistaken for a customer decline, a definitive failed payment, or permission to create a new commercial operation with another idempotency key. Existing durable pending/ambiguous claims remain subject to exact retry, provider-truth reconciliation, and verified webhook recovery.

## Validation

Focused tests cover full/partial/missing capturable evidence across the adapter, reconciliation, signed webhook parsing, and the integration fixtures; substituted capture/refund IDs, refund source substitution, invalid refund IDs, missing or mismatched received-money evidence, substituted reconciliation IDs, and impossible received/capturable amounts. The full repository Node 24 / TypeScript 6 / Prisma / PostgreSQL / build validation and live Stripe integration remain separate environment gates. No GitHub Actions are used.

## Terminal authorization recovery evidence

Stripe cancellation/release is only definitive when the exact requested PaymentIntent reports `canceled`, zero `amount_received`, and zero `amount_capturable`, with both fields explicitly present. A nominal amount and HTTP success alone cannot prove release. If a cancellation request unexpectedly reports `succeeded`, both terminal fields must also be present, the received amount must equal the requested amount, and capturable money must be zero; downstream recovery still decides whether that settled state is permitted.

PaymentIntent GET reconciliation and signed PaymentIntent webhook parsing now require both explicit money fields for `canceled` and `succeeded` states, just as `requires_capture` already requires them. This closes the missing-field-to-zero conversion that could otherwise make an incomplete canceled receipt look like released funds in commercial-amendment recovery. Invalid or incomplete terminal provider evidence fails closed without mutating settlement. Provider response tests cover canceled/settled omissions, inconsistent release money, and valid terminal evidence. Full repository Node 24, PostgreSQL, and live Stripe verification remain separate gates.

## Contradictory terminal money evidence

Terminal PaymentIntent evidence must be internally consistent, not merely present. A `canceled` intent must explicitly report both `amount_received = 0` and `amount_capturable = 0`; a `succeeded` intent must explicitly report `amount_capturable = 0`. A canceled intent with received money cannot be treated as a failed payment, and a succeeded intent with a remaining capturable balance cannot be treated as fully settled. Stripe GET reconciliation, signed webhook parsing, and the shared reconciliation decision now fail closed on these contradictions. Direct authorization/capture writes also reject contradictory terminal evidence; canceled write responses require both zero fields, while successful writes require an explicit zero capturable amount alongside the existing full received-money evidence.

These are provider-evidence failures, not customer declines or permission to start a new charge. Preserve the existing pending/ambiguous recovery state and reconcile the exact provider reference. Focused regression tests are checked in; full Node 24/TypeScript 6/PostgreSQL execution and live Stripe verification remain outstanding environment gates.

The `requires_payment_method` state is also mapped to failed payment reconciliation. When provider data explicitly reports any received or capturable funds in that state, GET reconciliation, signed webhook parsing, and the reconciliation domain reject it rather than writing a failed ledger row. Missing failed-state money fields also fail closed rather than being interpreted as zero. Other unresolved nonterminal states retain their existing pending/recovery behavior.
