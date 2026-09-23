# Stripe webhook tenant write scope

SF treats a signed Stripe callback as externally supplied provider truth that may drive durable commercial state. The webhook boundary therefore verifies the tenant-specific signature over the raw payload, deduplicates the provider event ID and payload hash, resolves tenant-owned booking/payment/session state, and applies mutations only inside the existing serializable transaction and advisory-lock boundary.

This review hardens the core `src/server/payments/stripe-webhook-service.ts` state machine. It does not make a browser redirect authoritative.

## Ingress resource boundary

The public webhook route performs cheap fail-closed metadata checks before it acquires the request body. The route organization parameter must already be a canonical UUID accepted by the shared tenancy identifier boundary, and `Stripe-Signature` must be present, non-empty, and no longer than the same 4,096-character ceiling retained by the webhook service for direct callers. Before body acquisition, the route requires plausible Stripe framing through the same shared framing parser used by provider verification: exactly one unambiguous timestamp (`t`) that is safe and non-zero, plus at least one 64-hex `v1` candidate. Multiple `v1` candidates remain valid for Stripe signing-secret rotation, while duplicate timestamps fail closed instead of relying on last-value parsing. Unknown signature schemes are ignored. This is resource preflight only, not cryptographic authority; tenant-specific HMAC verification and timestamp tolerance remain in the Stripe provider after the exact raw body is acquired. Invalid route identity or signature framing returns the safe `invalid-webhook` response before body acquisition and discards the unread request stream best-effort instead of knowingly leaving rejected public input attached to the route lifetime. It never establishes verified tenant log scope.

The public webhook route does not call `Request.text()` directly. `src/server/payments/stripe-webhook-request-body.ts` owns raw-body acquisition and enforces the 256 KiB Stripe webhook ceiling before the full request can be buffered by application code.

A canonical decimal `Content-Length` above the ceiling is rejected before body acquisition. `Content-Length` is only an early bound, not commercial authority: SF still counts every actual byte-stream chunk, rejects framing disagreement when a declared length does not equal the received raw-body length, cancels the request body best-effort as soon as the declared or absolute ceiling is crossed, and rejects aborted or malformed body streams. Total body acquisition is additionally bounded by an SF-owned 10-second deadline; the reader may be invoked with a shorter deadline for focused tests or stricter internal callers, but it refuses any override that would weaken the production ceiling. This prevents absent, understated, overstated, or indefinitely stalled framing from bypassing the public-ingress resource boundary.

When `Content-Length` is present, the reader allocates exactly that bounded size. Without framing, it grows one retained body buffer geometrically from 8 KiB up to the 256 KiB ceiling instead of retaining one copied allocation per incoming stream fragment or eagerly reserving the full ceiling. The public byte limit therefore bounds retained application body memory even when the HTTP runtime fragments a valid request into many small chunks. After the bounded byte stream is complete, SF performs fatal UTF-8 decoding over only the received prefix before passing the exact valid text to the existing Stripe signature verifier. Invalid UTF-8 is rejected instead of being replacement-normalized before HMAC verification.

The service keeps its own UUID, signature-header, and 256 KiB UTF-8 byte-length checks as defense in depth for direct callers; the route-level metadata and stream bounds prevent avoidable public-ingress work before those service checks. The payment provider independently consumes the shared signature framing parser before computing HMAC authority, so route preflight and provider verification cannot drift into different timestamp-selection rules.

Ingress body failures occur before `ingestStripePaymentWebhook`, so they never establish verified tenant log scope. Oversized bodies return HTTP 413, body-acquisition deadline failures return HTTP 408, and other malformed, framing-mismatched, or aborted body conditions return the existing safe `invalid-webhook` response without echoing request data. Unexpected internal failures are no longer reclassified as client input merely because an exception message happens to contain `organizationId` or `UUID`; only explicit ingress/service validation failures receive the client-safe invalid-webhook mapping.

## Checkout Session authority

A valid Stripe signature proves that Stripe signed the payload; it does not by itself prove that every Checkout Session field still represents the SF operation being finalized. For a tracked public booking Checkout, SF therefore rebinds the signed callback to the persisted Session before completion or expiry can change commercial state.

The callback must preserve the authority-bearing fields SF established when the Session was created:

- `mode` must remain `payment`;
- `client_reference_id` must equal the tracked booking ID;
- normal booking Checkout must not carry commercial-amendment context;
- `expires_at` must exactly match the persisted `PaymentCheckoutSession.expiresAt` value created from the reviewed Stripe Session;
- tenant and booking metadata, Session reference, amount, and currency must continue to match the tenant-owned persisted records.

A mismatch is persisted as an ignored provider event and cannot mark a payment successful, expire a tracked Session, or cancel inventory. This is intentionally stricter than signature verification because signed provider data is still external commercial evidence.

The same normalized Checkout parser is used by normal commercial-amendment and recovery Checkout webhook domains. Those flows require `payment` mode, `client_reference_id` equal to the metadata booking ID, a valid provider expiry, and their exact commercial purpose/amendment ID. They no longer reparse the raw JSON independently for amendment ownership.

## PaymentIntent attempt authority

Stripe does not guarantee webhook delivery order, so the generic PaymentIntent path does not use arrival order or `created` timestamps to decide which local attempt owns an event. It first resolves an exact tenant-and-booking-scoped persisted `pi_*` reference across normal authorization/capture lifecycles. Exact provider identity outranks any newer `sf_claim_*` pre-reference operation, preventing an older out-of-order event from being rebound onto a newer payment attempt.

When an exact normal operation is already `FAILED`, only positive `requires_capture` or `succeeded` truth can recover that exact attempt. Negative/incomplete snapshots do not reopen a failed attempt, and a `SUCCEEDED` operation is never regressed by stale provider evidence. Exact references owned by a commercial amendment or `AMBIGUOUS` specialized flow are ignored by the generic mutator so the route can continue into the existing amendment finalizers. Only when no exact provider identity exists may one normal `PENDING` operation with `commercialAmendmentId = null` accept first provider evidence.

The complete reasoning and validation contract is documented in `docs/stripe-webhook-payment-attempt-authority.md`.

## Final-write invariants

After the webhook has selected a tenant-owned resource and validated provider state, the final Prisma mutation repeats the validated ownership and lifecycle evidence instead of relying only on an earlier scoped read.

Checkout Session mutations retain:

- checkout session ID and `organizationId`;
- booking and payment-transaction identity;
- Stripe provider code and persisted Checkout Session reference;
- the expected `OPEN` lifecycle before completion or expiry.

Checkout payment settlement retains the transaction ID, tenant, booking, Stripe provider, `CAPTURE` kind, previously observed status/reference, currency, and exact integer-minor amount. The related booking update retains the tenant, `CONFIRMED` lifecycle, previously observed payment state, currency, and authoritative total.

Checkout expiry cancellation repeats the same payment ownership/provider/money evidence after the availability lock and re-read. The booking cancellation repeats the locked confirmed/payment lifecycle plus tenant and authoritative money evidence, so an ID-only mutation cannot silently ignore a state change observed after the earlier validation.

Refund callbacks retain the refund transaction ID, tenant, booking, Stripe provider, `REFUND` kind, expected `PENDING` state, persisted refund/source references, currency, and exact amount. Successful refund booking-state changes retain the same confirmed booking, prior payment state, currency, and total used by the allocation/reconciliation decision.

PaymentIntent callbacks retain the selected transaction ID, tenant, booking, provider, payment kind, exact prior lifecycle (`PENDING` or the narrowly recoverable exact-reference `FAILED` state), persisted provider reference, currency, and exact amount. The booking payment-state transition repeats the confirmed lifecycle and prior payment state.

These predicates are defense in depth. They do not replace signature verification, provider event idempotency, payload-hash conflict detection, exact provider-reference/money checks, settlement derivation, serializable transactions, advisory locks, or Stripe provider adapters.

## Similar-pattern sweep and scope boundary

The core webhook service was swept for `PaymentTransaction`, `PaymentCheckoutSession`, and `HospitalityBooking` updates that previously wrote by row ID after a tenant-scoped read. All high-confidence occurrences in this state machine are covered by this contract.

The PaymentIntent sweep additionally covered retry identity and out-of-order delivery. Exact provider-reference ownership is now consulted before pending pre-reference claims; failed exact attempts can recover only from positive compatible provider truth; and generic pending fallback explicitly excludes commercial-amendment ownership. Refund handling remains intentionally separate because its settlement lifecycle and source-allocation contract differ from PaymentIntent retry semantics.

The same Checkout authority concern was swept through the commercial-amendment webhook parsers for both charge and recovery flows. Their existing amendment-owned payment lifecycles, signed-event promotion, immutable amendment snapshots, apply/compensation semantics, and final serializable writes remain unchanged; this pass only centralizes and tightens the provider Session ownership evidence they accept. Initial authorization/capture/refund provider calls and public Checkout creation remain separate boundaries.

The ingress resource sweep found only one direct `Request.text()` call in the repository: the Stripe webhook route. That public provider-ingress path now rejects malformed tenant/signature metadata first, discards rejected unread streams best-effort, and then streams accepted requests through the bounded raw-body reader before signature verification; no unrelated request-body abstraction was introduced. The signature-framing sweep found two parsing locations—the ingress preflight and the Stripe payment provider—and now gives both the same dependency-free parser while preserving HMAC/tolerance authority exclusively in the provider.

## Verification

`scripts/stripe-webhook-write-scope.test.mjs` is a dependency-free source contract that prevents the core webhook state machine from regressing to ID-only payment, booking, or checkout-session writes. It also verifies that raw-payload signature verification precedes durable event processing, that tracked Checkout callbacks pass through the Session-authority boundary before settlement/expiry handling, that commercial-amendment parsers use the normalized Checkout authority, and that serializable/advisory-lock behavior remains present.

`src/server/payments/stripe-webhook-payment-mutation-domain.test.ts` covers exact historical provider identity outranking a newer claim, compatible recovery of exact failed operations, stale-event non-regression, specialized-flow isolation, incompatible exact ownership, and normal first-provider-evidence binding. `scripts/stripe-webhook-payment-attempt-authority-contract.test.mjs` protects the service wiring and final expected-lifecycle predicate.

`src/server/payments/stripe-webhook-domain.test.ts` covers normalized Checkout authority and exact normal-booking decisions. The commercial-amendment Checkout webhook domain tests cover exact payment mode, booking reference, expiry presence, purpose, and amendment ownership for both normal additional-charge and recovery Sessions.

`src/server/payments/stripe-webhook-ingress-signature-domain.test.ts` covers exact-one timestamp framing, multiple rotation signatures, malformed candidates, immutability, header bounds, and duplicate-timestamp rejection. `scripts/stripe-webhook-signature-authority-contract.test.mjs` protects the shared parser/provider boundary so public preflight and HMAC verification cannot silently return to separate timestamp parsers.

`src/server/payments/stripe-webhook-request-body.test.ts` covers the exact 256 KiB boundary, declared and actual oversize rejection, declared-length disagreement, invalid UTF-8, request-abort behavior, best-effort preflight discard, the 10-second production deadline contract, and stalled-body timeout cancellation. `scripts/stripe-webhook-ingress-resource-contract.test.mjs` protects early tenant/signature metadata rejection, plausible timestamp/v1 framing, discard, route ordering, actual-byte counting, bounded retained-memory behavior, early `Content-Length` rejection, framing disagreement, safe HTTP mapping, removal of exception-message classification, and the service-level signature/payload checks retained as defense in depth.

Full Prisma validation/generation, repository TypeScript checking, lint, tests, production build, database-backed webhook concurrency scenarios, and live Stripe verification still require the repository-supported Node 24 environment, installed dependencies, an explicitly disposable PostgreSQL target where applicable, and provisioned provider configuration. GitHub Actions are intentionally not used.
