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

## Direct authorization decline evidence

A synchronous Stripe PaymentIntent create/confirm response with `requires_payment_method` is a failed authorization attempt only when it explicitly reports both `amount_received = 0` and `amount_capturable = 0`. The authorization adapter now returns `FAILED` for that exact provider-proven decline, so the tenant-owned idempotent authorization ledger and booking payment state can record the definitive attempt without waiting for a separate reconciliation call. Missing, malformed, or nonzero failed-state money is retryable unknown provider truth and leaves the durable claim available for exact-reference recovery; it is never treated as a decline.

This rule is intentionally operation-specific. A cancellation response reporting `requires_payment_method` does **not** prove that the PaymentIntent was canceled and remains pending release/reconciliation; a capture response with no received money cannot prove the requested capture amount and remains unknown. The provider-truth GET and signed webhook boundaries retain their separate zero-money failed-state validation. A Stripe PaymentIntent can be reused after a failed attempt, so exact-reference webhook recovery remains authoritative if that same object later becomes capturable or settled.

Regression cases cover evidenced declines, missing/null/contradictory money, and the non-equivalence of failed authorization, cancellation, and capture. These cases are checked in but require the repository Node 24 toolchain to execute; no live Stripe or PostgreSQL validation is claimed.

## Nonterminal authorization and capture evidence

A Stripe PaymentIntent that is still processing, requires customer action, or otherwise has not reached a definitive authorization/settlement state must explicitly show zero received and capturable funds before the direct authorization adapter returns `PENDING`. Missing or contradictory money is retryable unknown provider truth, not a safe pending/failed outcome.

For a capture response, SF no longer substitutes the nominal PaymentIntent amount when `amount_received` is absent. The adapter requires explicit, bounded received/capturable minor units and matching currency/nominal amount, including on nonterminal responses. A still-`requires_capture` PaymentIntent with zero received money and a positive capturable balance means **the requested capture has not completed**: the capture adapter returns `PENDING`, never `AUTHORIZED` (which the capture persistence boundary does not accept). Nonzero received money in an unresolved capture, contradictory totals, canceled/failed capture states, and missing money remain retryable `UNKNOWN` pending exact-reference reconciliation. A `succeeded` capture still requires exact received money equal to the requested capture and zero remaining capturable money; the original nominal intent amount may be larger for an intentional partial capture.

An authorization-release response that remains nonterminal is also not a successful new authorization: it requires explicit, consistent received/capturable evidence and returns `PENDING` while the existing recovery flow continues to require definitive canceled/zero-money proof. Missing or contradictory release money is retryable `UNKNOWN`.

Direct authorization, capture, and authorization-release writes also reject missing, malformed, or unrecognized PaymentIntent statuses. Only Stripe's documented status vocabulary can influence payment operation state; an unknown provider status is retryable `UNKNOWN`, not an ordinary pending payment.

These are adapter evidence rules, not a new provider capability or payment-state transition. Existing tenant-scoped durable claims and provider-truth reconciliation remain authoritative. Regression tests are checked in; live Stripe and full repository Node 24/PostgreSQL execution remain outstanding.

## Complete nonterminal PaymentIntent money evidence

Stripe GET reconciliation and signed PaymentIntent webhooks require explicit
`amount_received` and `amount_capturable` for every recognized status,
including `processing`, `requires_action`, and `requires_confirmation`.
A nonterminal snapshot may later influence authorization or commercial recovery,
so missing fields are unknown provider truth, never evidence of zero money.
Complete pending evidence still remains pending.

Both fields must be safe, nonnegative integer minor units no greater than the
nominal PaymentIntent amount; their combined value must not exceed that amount.
The shared reconciliation domain independently rejects contradictory snapshot
money, including signed-event snapshots. Commercial-amendment and expired
recovery webhook paths also reject missing capturable fields when rereading
verified payloads instead of defaulting them to zero.

Focused regression tests and a dependency-free source contract are checked in.
Full repository Node 24/TypeScript 6/Prisma/PostgreSQL validation and live Stripe
verification remain separate environment gates; no new provider capability or
supplier reservation has been enabled.

## Persisted provider reference and commercial charge evidence

`PaymentTransaction.providerReference` and `sourceProviderReference` are PostgreSQL `VARCHAR(160)`. Stripe PaymentIntent, Refund, and Checkout Session references must fit that limit **before** SF accepts a provider result, returns a hosted Checkout URL, persists a payment/refund claim, or performs a provider-truth lookup. A newly created oversized provider ID is retryable `UNKNOWN` provider evidence because the external payment operation may already have happened; an oversized caller-supplied lookup ID is `INVALID_REQUEST` before network I/O. Refund reconciliation likewise treats an invalid PaymentIntent ID **returned by Stripe** as retryable unknown evidence, not as an invalid customer request.

The same limit is checked again in commercial-amendment charge/refund/recovery domain and persistence boundaries. Commercial-amendment charge reconciliation also rejects contradictory received/capturable money, unrecognized PaymentIntent statuses, nonzero capturable funds on settlement, and nonzero money on definitive failure. This is defense in depth behind the Stripe adapter and does not authorize new retries, new money movements, or a provider reservation capability.

Focused adapter and domain tests cover the 160-character boundary, provider-versus-caller failure classification, and commercial-amendment charge state consistency. Full Node 24 / TypeScript 6 / Prisma / PostgreSQL and live-provider validation remain separate requirements.

## Stripe provider response framing and currency authority

Stripe provider currency is not caller input. Direct PaymentIntent authorization/capture/release, refund creation, Checkout creation/retrieval, and PaymentIntent/Refund GET reconciliation now require a supported ISO currency in Stripe's exact lowercase three-letter response format. Missing, padded, uppercase, fabricated, or non-string provider currencies are retryable `UNKNOWN` provider evidence rather than caller-input errors or definitive payment declines. Existing exact expected-currency and amount comparisons remain in force.

Checkout creation and retrieval reject 2xx responses containing null, arrays, or scalar JSON before accessing Session properties. Stripe error bodies are likewise untrusted: malformed error objects no longer erase the authoritative HTTP 401/429 classification, and upstream diagnostics are bounded and control-character filtered before entering provider errors. No new charge/retry authority, supplier capability, or payment-state transition is introduced. Added unit regression cases require the repository Node 24 toolchain to execute; live Stripe and disposable PostgreSQL verification remain separate outstanding gates.
