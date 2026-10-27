# Stripe Checkout session authority

## Purpose

Stripe Checkout Session creation returns customer redirect authority as well as provider identifiers. SF treats that response as untrusted provider input until the created Session is bound back to the exact booking or commercial amendment that requested it.

This boundary lives in `src/server/payments/stripe-checkout-provider.ts` and applies before a Checkout URL can be returned to a public customer or staff workflow. Signed Checkout callbacks reuse the same ownership model before provider evidence can finalize or expire tracked payment state.

## Created Session binding

A successful create response must agree with the request on all authority-bearing fields that SF sent to Stripe:

- the object must be a Checkout Session in `payment` mode, with hosted UI mode when returned;
- the newly created positive-value Session must be `open` and `unpaid`, never already completed, expired, paid, or payment-free;
- `success_url` and `cancel_url` must exactly equal the server-derived destinations submitted to Stripe, without redirect drift;
- `client_reference_id` must equal the requested booking ID;
- `metadata.sf_organization_id` and `metadata.sf_booking_id` must equal the requested tenant and booking;
- normal booking Checkout must not gain commercial-amendment metadata;
- commercial-amendment Checkout must return the exact expected purpose and amendment ID;
- `expires_at` must equal the 33-minute expiry SF requested rather than extending or shortening the commercial payment window;
- amount and currency must still exactly match the requested money.

Any disagreement is retryable `UNKNOWN` provider evidence. SF does not persist the mismatched Session or redirect a customer to it.

## Signed callback binding

A valid Stripe webhook signature authenticates the payload source but does not replace SF's persisted commercial ownership checks. Before a tracked public booking `checkout.session.completed` or `checkout.session.expired` event can update payment/session/booking state, SF requires the callback Session to preserve:

- `mode=payment`;
- the exact booking `client_reference_id`;
- no commercial-amendment context for a normal booking payment;
- the exact persisted Checkout expiry;
- the already enforced tenant/booking metadata, provider Session reference, amount, and currency.

Commercial-amendment charge and recovery callbacks use the same normalized parser and require payment mode, a booking-matching client reference, a valid expiry, and the exact expected purpose/amendment ID. This keeps create authority and signed callback authority aligned instead of reparsing amendment metadata through a separate path.

Mismatched signed evidence fails closed and is not allowed to settle payment, expire a tracked Session, or cancel booking inventory.

## Redirect target boundary

The current SF integration supports Stripe's default hosted Checkout URL only. The returned URL must use HTTPS on `checkout.stripe.com`, contain no URL credentials or alternate port, remain within the existing 4,096-character bound, and use the exact default hosted `/c/pay/<session-id>` path. The path must contain the returned Checkout Session ID literally, without alternate prefixes, extra separators, trailing path segments, or parser-normalized dot segments. A URL for another Session, a lookalike hostname, or an unrelated HTTPS origin fails closed.

Stripe supports custom Checkout domains, but SF does not currently model a tenant-owned Stripe Checkout custom domain or verification state. Custom Checkout domains are therefore intentionally unsupported rather than implicitly trusting any HTTPS hostname returned by a provider response. Supporting them later requires an explicit tenant/provider configuration and verification contract.

Stripe redirect URL evidence is also checked in its original raw form before WHATWG URL parsing. Leading/trailing whitespace, C0/C1 control characters (including raw CR, LF, and TAB), unpaired Unicode surrogates, and URLs over 4,096 characters fail closed as retryable unknown provider evidence. This prevents the URL parser from silently removing or replacing characters before SF returns the hosted destination to a browser. Normal Stripe Checkout hash fragments remain supported. The raw URL must also begin with the canonical `https://checkout.stripe.com/c/pay/<session-id>` route, with only a query string or hash fragment allowed after the ID. Alternate Stripe-hosted paths are not trusted merely because they end in a matching Session ID.

The entire returned Checkout URL, including any query or fragment suffix, must already be an exact canonical WHATWG URL string. Unescaped spaces, non-ASCII characters, and other suffix text that a URL parser would silently percent-encode are rejected as ambiguous provider evidence. SF returns the original URL only when it is unchanged by parsing, and preserves canonical encoded query/fragment tokens exactly. This extends the same raw-evidence policy already used for the payment return destinations.

The Checkout URL is navigation authority only. It never proves payment. Signed Stripe callbacks and explicit provider reconciliation remain the payment-truth boundaries, and both are still subject to SF-owned operation binding before commercial state changes.

## Provider reconciliation binding

Explicit Checkout retrieval is also treated as external provider evidence rather than trusted just because the requested Session ID matches. Before SF returns a retrieved Session snapshot to commercial-amendment reconciliation, the provider response must still be a `payment` Session with hosted UI mode when returned, its `client_reference_id` must equal the normalized booking ID carried in SF metadata, and `expires_at` must remain a valid provider timestamp. Existing reconciliation then separately requires the exact tenant, booking, amendment, purpose, Session reference, amount, currency, and settlement state.

This prevents a same-ID response with drifted operation authority from becoming polling/reconciliation truth. Commercial amendment flows do not currently persist a dedicated Checkout expiry column, so polling requires a valid expiry but does not claim an exact persisted-expiry comparison there; the public booking webhook path can and does compare against `PaymentCheckoutSession.expiresAt`.

## Validation

`src/server/payments/stripe-checkout-provider.test.ts` covers exact created-Session binding, expiry authority, default hosted redirect authority, hostname/session mismatch rejection, exact money, and existing reconciliation behavior. `src/server/payments/stripe-webhook-domain.test.ts` covers signed Checkout authority normalization and normal-booking binding. The commercial-amendment Checkout webhook domain tests cover normal additional-charge and recovery Session ownership. `scripts/stripe-webhook-write-scope.test.mjs` protects the core service ordering so authority validation remains before settlement/expiry handling.

Full repository Node 24 / TypeScript 6 validation, Prisma/PostgreSQL execution, production build, and live Stripe validation remain separate environment gates. GitHub Actions are intentionally not used.

## Canonical Checkout ownership and preflight (October 27, 2026)

Checkout creation now rejects noncanonical tenant/booking UUIDs, unknown runtime purposes, and absent, padded, uppercase, or unexpected commercial-amendment IDs **before contacting Stripe**. The adapter no longer silently trims or lowercases a persisted commercial amendment identity or ignores an explicitly supplied empty amendment ID on a normal booking. Canonical lowercase UUIDs from the database remain unchanged.

Successful Session creation and provider-truth GET retrieval now treat ownership metadata as **exact provider text**, not a case-insensitive UUID that may be normalized into an expected tenant/booking. Retrieval requires a valid tenant ID, the exact booking client reference, and a complete purpose/amendment pair when commercial context is present. Malformed or contradictory provider receipts remain retryable `UNKNOWN`; invalid preflight input is `INVALID_REQUEST` with zero outbound Stripe requests. Application reconciliation must still independently check tenant-owned persisted operations, expected money, and lifecycle state. Focused tests are checked in; full Node 24/Prisma/PostgreSQL/Stripe execution remains an outstanding environment gate.

## Preflight money and time authority

Checkout shares the same strict pre-provider write-context validation as Stripe authorization, capture, release, and refunds. An otherwise valid booking ID cannot authorize a Stripe request with zero/negative/unsafe-precision minor units, non-bigint money, altered currency text, or a padded idempotency key. Invalid caller-supplied dates cannot create a malformed `expires_at` request. All of these cases return `INVALID_REQUEST` without contacting Stripe; successful provider responses still require exact session ownership, expiry, and money binding.

## Customer contact and return URL preflight

Checkout creation now validates optional customer email and both redirect URLs before any provider request. A supplied email must be a non-empty, unpadded, bounded (320-character) address without control characters or unpaired Unicode surrogates; null or absent email remains valid and omits the Stripe form field. Malformed runtime values are not silently stringified into a Stripe `customer_email` value. Both return URLs must be non-empty, bounded, unpadded strings without C0/C1 controls or unpaired Unicode surrogates, in addition to the existing HTTPS (or local-development loopback HTTP) and no-credentials restrictions. This prevents URL parsing from silently discarding raw newlines or whitespace before a payment redirect is created.

An explicitly null Checkout purpose or caller-supplied clock is no longer interpreted as an omitted optional field. Only `undefined` selects the default booking-payment purpose or current clock. Invalid supplied authority fails with non-retryable `INVALID_REQUEST` and no outbound Stripe call. The existing server-derived URLs, canonical customer records, tenant ownership, durable idempotency, and provider-truth settlement contracts are unchanged. Focused negative-case tests are checked in; full Node 24, TypeScript 6, Prisma/PostgreSQL, build, and live Stripe validation remain external gates.

## Created-session payment and redirect readiness (October 27, 2026)

Stripe's Checkout Session object exposes `status`, `payment_status`, `success_url`, `cancel_url`, and `ui_mode`. SF now checks that a new positive-value Session is still open and unpaid, has no contradictory embedded/custom UI mode, and echoes both exact server-selected return URLs before the customer receives the hosted redirect or SF persists the operation as an open Checkout Session. This does not use a browser redirect as settlement evidence. Explicit retrieval also rejects a returned non-hosted UI mode without assuming a missing legacy `ui_mode` property proves a different mode. Invalid provider receipts remain retryable `UNKNOWN` for safe claim reconciliation. Regression fixtures include the valid provider fields and reject missing, contradictory, and mismatched values. Live Stripe and full Node 24/PostgreSQL validation remain outstanding.

## Canonical outbound return URL evidence (October 28, 2026)

The shared Checkout adapter now requires the exact server-supplied success and cancellation URLs to already be canonical WHATWG URL strings before contacting Stripe. Previously the adapter returned the parser-normalized form, which could silently rewrite uppercase/default-port hostnames, backslash separators, dot-segment paths, unescaped query spaces, or Unicode hostnames. Trailing-dot DNS hostnames are also rejected, matching the deployment-origin policy. These inputs now fail with non-retryable `INVALID_REQUEST` before Stripe I/O, rather than creating a payment operation with a different return destination from the one the caller supplied.

Existing canonical HTTPS destinations and canonical local-development HTTP loopback URLs remain supported. This is adapter-level defense in depth in addition to the configured-origin enforcement on all three Checkout routes; it does not grant tenant custom-domain routing or change payment truth. Focused provider regression cases and a dependency-free source contract are checked in. Full Node 24/TypeScript 6/Prisma/PostgreSQL/build and live Stripe validation remain unverified until the required environment is available.

## Current Stripe hosted UI and expiry contract (October 28, 2026)

Stripe's current [Checkout Session API](https://docs.stripe.com/api/checkout/sessions/object) identifies its hosted redirect UI as `ui_mode: hosted_page`, not `hosted`. SF now requests `hosted_page` explicitly and accepts that exact value (or an omitted legacy response field) for creation and retrieval. `embedded_page`, `elements`, `form`, and the undocumented `hosted` alias remain unsupported. This fixes a real-provider compatibility gap that the older `hosted` test fixture had concealed; the normal and commercial-amendment fixtures now include the actual required open/unpaid and return-destination evidence.

Stripe's [creation contract](https://docs.stripe.com/api/checkout/sessions/create) requires `expires_at` to be at least 30 minutes after **Stripe creates** the Session. A timestamp calculated as exactly 30 minutes after SF's earlier claim-time clock can already be too early by the time Stripe receives the request. SF now requests a fixed 33-minute window from that claim-time clock, allowing the maximum configured 120-second request timeout plus a small clock/queue margin. The exact returned timestamp is still required, persisted, and used for webhook expiry authority. Checkout can outlive a prepared commercial amendment; existing amendment expiry and compensation rules remain authoritative and are not extended by this change.

This is a documented provider-contract correction with focused regression fixtures. Live Stripe test-mode creation, the full Node 24/TypeScript 6 suite, Prisma/PostgreSQL validation, and production build remain unverified in this execution environment. No GitHub Actions are used.
