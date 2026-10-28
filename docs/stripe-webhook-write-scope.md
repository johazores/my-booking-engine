# Stripe webhook tenant write scope

SF treats a signed Stripe callback as externally supplied provider truth that may drive durable commercial state. The webhook boundary therefore verifies the tenant-specific signature over the raw payload, deduplicates the provider event ID and payload hash, resolves tenant-owned booking/payment/session state, and applies mutations only inside the existing serializable transaction and advisory-lock boundary.

This review hardens the core `src/server/payments/stripe-webhook-service.ts` state machine. It does not make a browser redirect authoritative.

## Ingress resource boundary

The public webhook route performs cheap fail-closed metadata checks before it acquires the request body. The route organization parameter must already be a canonical UUID accepted by the shared tenancy identifier boundary, and `Stripe-Signature` must be present, non-empty, and no longer than the same 4,096-character ceiling retained by the webhook service for direct callers. Before body acquisition, the route requires plausible Stripe framing through the same shared framing parser used by provider verification: exactly one unambiguous timestamp (`t`) that is safe and non-zero, plus at least one 64-hex `v1` candidate. Multiple `v1` candidates remain valid for Stripe signing-secret rotation, while duplicate timestamps fail closed instead of relying on last-value parsing. Unknown signature schemes are ignored. This is resource preflight only, not cryptographic authority; tenant-specific HMAC verification and timestamp tolerance remain in the Stripe provider after the exact raw body is acquired. Invalid route identity or signature framing returns the safe `invalid-webhook` response before body acquisition and discards the unread request stream best-effort instead of knowingly leaving rejected public input attached to the route lifetime. It never establishes verified tenant log scope.

The public webhook route does not call `Request.text()` directly. `src/server/payments/stripe-webhook-request-body.ts` owns raw-body acquisition and enforces the 256 KiB Stripe webhook ceiling before the full request can be buffered by application code.

A canonical decimal `Content-Length` above the ceiling is rejected before body acquisition. `Content-Length` is only an early bound, not commercial authority: SF still counts every actual byte-stream chunk, rejects framing disagreement when a declared length does not equal the received raw-body length, cancels the request body best-effort as soon as the declared or absolute ceiling is crossed, and rejects aborted or malformed body streams. Total body acquisition is additionally bounded by an SF-owned 10-second deadline; the reader may be invoked with a shorter deadline for focused tests or stricter internal callers, but it refuses any override that would weaken the production ceiling. This prevents absent, understated, overstated, or indefinitely stalled framing from bypassing the public-ingress resource boundary.

When `Content-Length` is present, the reader allocates exactly that bounded size. Without framing, it grows one retained body buffer geometrically from 8 KiB up to the 256 KiB ceiling instead of retaining one copied allocation per incoming stream fragment or eagerly reserving the full ceiling. The public byte limit therefore bounds retained application body memory even when the HTTP runtime fragments a valid request into many small chunks. The reader also rejects more than 16,384 streamed chunks, including empty and tiny chunks, independently of its 256 KiB byte ceiling and 10-second deadline. Rejection uses the existing safe invalid-webhook classification. Actual webhook bytes are counted with the native typed-array length, not a caller-shadowed chunk property. Cancellation after a malformed/oversized/over-chunked stream is best-effort and never awaited, so a stalled upstream cancellation promise cannot prevent the request from finishing. This same concern is covered for the shared JSON and browser form ingress readers.

The webhook reader shares the nonblocking unread-body discard and reader-cancellation safeguards with JSON and browser-form ingress. Invalid internal deadline overrides discard unread input before returning an invalid-body error; already locked or consumed bodies are not taken away from other readers. A read failure also attempts best-effort reader cancellation without masking the original invalid-body classification. Early abort/deadline detection cancels the acquired reader rather than leaving unread input attached to the request.

The raw reader also rejects missing or empty webhook bodies, previously consumed request bodies even when the old stream reader released its lock, and already locked bodies. It rechecks client abort and the shared deadline after the terminal stream read, before accepting framing or decoding the payload. This prevents a disturbed or concurrently aborted stream from being mistaken for fresh signature evidence. These checks do not replace tenant-specific HMAC verification.

Synchronous stream-reader failures now follow the same settled-and-cleaned-up path as asynchronous read rejections. Abort/deadline listeners are removed before the outer reader cleanup cancels the failed stream, so a later client abort or cancellation-triggered abort cannot cancel twice. Rejected, throwing, or stalled cancellation never delays the existing safe invalid-body response. Focused tests cover synchronous failures, cancellation-triggered aborts, and late read rejection after abort.

After the bounded byte stream is complete, SF performs fatal UTF-8 decoding over only the received prefix before passing the exact valid text to the existing Stripe signature verifier. Invalid UTF-8 is rejected instead of being replacement-normalized before HMAC verification.

The service keeps its own UUID, signature-header, and 256 KiB UTF-8 byte-length checks as defense in depth for direct callers; the route-level metadata and stream bounds prevent avoidable public-ingress work before those service checks. The payment provider independently consumes the shared signature framing parser before computing HMAC authority, so route preflight and provider verification cannot drift into different timestamp-selection rules.

Ingress body failures occur before `ingestStripePaymentWebhook`, so they never establish verified tenant log scope. Oversized bodies return HTTP 413, body-acquisition deadline failures return HTTP 408, and other malformed, framing-mismatched, or aborted body conditions return the existing safe `invalid-webhook` response without echoing request data. Unexpected internal failures are no longer reclassified as client input merely because an exception message happens to contain `organizationId` or `UUID`; only explicit ingress/service validation failures receive the client-safe invalid-webhook mapping.

## Signature timestamp identity

The shared preflight/provider framing parser accepts only canonical positive decimal Unix-second timestamps. Leading-zero timestamp aliases, signed or unsigned, and timestamps beyond the native Date range fail before body acquisition and cannot reuse a valid HMAC over a different textual `t` value. Provider verification continues to compute HMAC over the exact canonical timestamp and raw payload; this does not change the inclusive replay tolerance or the multiple-`v1` rotation contract.

## Signature verification clock authority

Stripe HMAC verification requires a finite, native Date timestamp before applying the configured replay tolerance. A malformed or invalid injected clock must fail closed: `NaN` previously made `Math.abs(nowSeconds - signatureTimestamp) > tolerance` false, which could bypass the timestamp window for an otherwise correctly signed older payload. The provider now reads the native Date time slot, rejects invalid Date values, non-Date runtime values, and forged Date-like objects, and never trusts an overridden `getTime` method. An omitted clock still uses the server clock; an explicitly null clock is invalid rather than silently treated as omitted.

Malformed runtime payload or secret types also fail verification rather than reaching string coercion or throwing from `trim`. Valid signed payloads, the inclusive configured timestamp window, multiple `v1` signing candidates, and the existing tenant-specific raw-body/HMAC verification remain unchanged. This is adapter defense in depth: production ingress supplies the server clock and still enforces tenant-owned signing secrets, bounded raw bodies, durable event deduplication, and commercial ownership before mutation.

Focused adapter regressions and a dependency-free source contract cover the clock and type boundaries. Full Node 24, Prisma/PostgreSQL, and live Stripe verification remain separate environment gates.

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

The candidate-selection contract is implemented and tested in `src/server/payments/stripe-webhook-payment-mutation-domain.ts` and its companion test; this document covers the persistence boundary.

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

`src/server/payments/stripe-webhook-request-body.test.ts` covers the exact 256 KiB boundary, declared and actual oversize rejection, declared-length disagreement, invalid UTF-8, request-abort behavior, best-effort preflight discard, the 10-second production deadline contract, stalled-body timeout cancellation, missing/empty and consumed/locked request rejection, and rejection of an aborted stream with queued bytes. `scripts/stripe-webhook-ingress-resource-contract.test.mjs` protects early tenant/signature metadata rejection, plausible timestamp/v1 framing, discard, route ordering, actual-byte counting, bounded retained-memory behavior, early `Content-Length` rejection, framing disagreement, safe HTTP mapping, removal of exception-message classification, and the service-level signature/payload checks retained as defense in depth.

Full Prisma validation/generation, repository TypeScript checking, lint, tests, production build, database-backed webhook concurrency scenarios, and live Stripe verification still require the repository-supported Node 24 environment, installed dependencies, an explicitly disposable PostgreSQL target where applicable, and provisioned provider configuration. GitHub Actions are intentionally not used.

## Ambiguous HTTP request framing

The shared request-body framing policy rejects noncanonical `Content-Length` (including leading zeros and oversized decimal strings) and requests carrying both `Content-Length` and `Transfer-Encoding`. Absent lengths remain valid for bounded streaming. The same policy protects JSON, browser forms, and raw Stripe webhook bodies, preserving each caller's invalid-input/oversize classification, nonblocking rejected-body cleanup, streamed byte limits, tenant authorization, and provider signature authority. This is defense in depth against proxy/application framing disagreement, not a replacement for edge/proxy request-smuggling protections. Focused tests cover all three ingress families.

## Malformed raw-body stream results

The Stripe raw-body reader now normalizes unexpected read-result shapes, throwing read-result properties, and detached byte-copy failures to its existing `INVALID_BODY` transport classification. It best-effort cancels the reader and never forwards those bytes to signature verification or exposes a raw internal exception. The shared JSON/form reader has the corresponding malformed-result guard. Focused injected-reader regressions are checked in; live provider and full Node 24 validation remain separate gates.

## Stable signed-body stream-result snapshots

The Stripe raw-body reader now normalizes each stream-read result before resolving the pending read. One-shot or changing `done`/`value` accessors cannot bypass its validated result shape, and completed reads never inspect `value`. Malformed results retain the existing `INVALID_BODY` mapping and nonblocking reader cancellation; no bytes reach HMAC verification without bounded acquisition. The same snapshot policy protects JSON and form ingress. Focused regression tests are checked in, while full Node 24 and live Stripe validation remain separate gates.

## Refund webhook ownership scope

The refund parser now preserves canonical SF organization/booking metadata from signed Refund objects. Ingestion ignores missing, malformed, cross-tenant, or cross-booking metadata before binding a pending refund claim. Normal, commercial-amendment, and recovery refund lifecycle/finalizer services independently recheck tenant ownership before lookup and booking ownership before applying a selected transaction, including for already-recorded ignored events. Refund reference, source PaymentIntent, amount, currency, and event hash remain separate checks. Unit tests cover invalid/missing/conflicting metadata; the guarded PostgreSQL integration adds ignored-event cases before valid finalization. Full Node 24/PostgreSQL and live Stripe verification remain pending. No GitHub Actions are used.

### Exact metadata token parsing

Signed Refund, PaymentIntent, and Checkout UUID ownership fields are now checked as raw provider strings without trimming whitespace; commercial-amendment UUIDs, Checkout client references, and commercial purpose tokens use the same exactness rule. This prevents padded or newline-suffixed Stripe metadata from becoming canonical tenant/booking authority. Existing missing/malformed handling remains fail-closed, and source money/reference checks are unchanged. The Checkout provider applies exact UUID/purpose parsing on successful Session creation and read-only retrieval as well. Focused regression cases are checked in; full Node 24/PostgreSQL validation remains outstanding.

Checkout Session commercial metadata is also checked for unexpected *key presence*, not just normalized values. Empty or whitespace-only `sf_checkout_purpose` / `sf_commercial_amendment_id` cannot silently make a commercial response look like an ordinary booking payment. Retrieval rejects malformed present commercial metadata rather than returning it as absent.

### Canonical signed UUID evidence (October 27, 2026)

The same-scope Checkout ownership review found that the signed Stripe webhook parser still case-folded otherwise valid uppercase UUID metadata into SF's lowercase tenant, booking, client-reference, or commercial-amendment IDs. It now requires exact canonical lowercase provider text, matching Checkout creation/retrieval and direct PaymentIntent/Refund response ownership. Noncanonical signed fields normalize to absent authority, so existing downstream tenant/booking and commercial-purpose guards ignore the event rather than applying payment state. No signed webhook is reinterpreted as a new customer payment, and valid canonical events remain unchanged. Focused negative regression cases are checked in; Node 24, PostgreSQL, and live Stripe verification remain outstanding.

### Exact signed machine-token evidence (October 27, 2026)

The final same-scope sweep also found that signed webhook event IDs/types, PaymentIntent/Refund/Checkout resource IDs, statuses, and Checkout's optional PaymentIntent reference were being whitespace-trimmed before machine-token validation. The parser now preserves these values exactly: padded required fields fail their existing ID/status/type checks, padded optional PaymentIntent references fail validation, and a padded Checkout mode cannot be treated as `payment` by downstream authority checks. Whitespace-only Checkout mode values mean absent mode authority; malformed present PaymentIntent references must fail validation. No event is allowed to settle money merely because its signed machine text can be repaired by normalization. Negative parser regressions are checked in; full Node 24 and database execution remains pending.

### Malformed present Checkout PaymentIntent evidence (October 27, 2026)

An expired signed Checkout Session can release a pending booking only when no
PaymentIntent exists. The webhook parser previously mapped whitespace-only
`payment_intent` strings and non-string expanded/invalid values to `null`.
That could incorrectly supply the no-PaymentIntent prerequisite to the
inventory-release decision. The parser now accepts `null` or an omitted field
as absent, and requires every present non-null reference to be an exact,
bounded `pi_*` machine token. Invalid present evidence is rejected before
webhook persistence or booking mutation, retaining the booking for investigation
rather than converting uncertain payment evidence into cancellation authority.
The read-only Checkout provider already enforced this strict distinction.
Focused regression cases are checked in; full Node 24/PostgreSQL and live
Stripe verification remain outstanding.

## Signed PaymentIntent and refund cross-booking ownership (October 28, 2026)

The normal signed PaymentIntent webhook now rejects a same-tenant PaymentIntent reference appearing on **any** other booking before it changes a selected payment transaction or booking state. This check applies equally to an exact `pi_*` operation being recovered and a pending `sf_claim_*` operation being bound for the first time. Previously the cross-booking query ran only for the internal-claim branch; an exact failed/pending reference could be promoted even when another booking already held that provider identity. Authorization/capture pairs on the same booking remain valid.

The normal refund webhook derives its source booking only from successful **base-booking** settlement candidates, then checks that source PaymentIntent against **all** same-tenant payment transaction kinds and statuses, rather than relying only on its bounded list of successful settlement candidates. Historical failed/ambiguous foreign rows cannot lend a source reference to a refund. The pending refund candidate reader and all normal webhook payment mutations explicitly retain `commercialAmendmentId = null` so amendment-owned money cannot be selected or rewritten through the generic booking flow. Exact amendment PaymentIntent candidates remain visible to the existing specialized-flow selection and are not reclassified as ordinary payments.

The dependency-free `scripts/stripe-webhook-write-scope.test.mjs` checks both reference guards, mutation ordering, and base-booking attribution. Disposable-PostgreSQL integration scenarios cover exact and internal-claim PaymentIntent collisions and a refund-source collision from a failed foreign authorization. The refund integration fixture now records its required source PaymentIntent attribution. These tests are **checked in, not claimed executed** without the repository Node 24 toolchain and disposable PostgreSQL target.

These are sequential/read-time integrity checks within the existing serializable webhook transaction. They do **not** establish database-wide concurrent uniqueness for provider references across operation kinds or across independent writers. A separately reviewed, database-enforced claim strategy and live Stripe verification remain open. No GitHub Actions are used.
