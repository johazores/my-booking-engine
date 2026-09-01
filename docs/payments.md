# Payments

SF keeps booking state and payment state separate. Provider-specific behavior stays behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state updates, and audit history.

## Implemented foundation

`src/server/payments/payment-provider.ts` defines the provider-independent contract and explicit capabilities:

- `OFFLINE_RECORDING`
- `OFFLINE_REFUND_RECORDING`
- `AUTHORIZE`
- `CAPTURE`
- `REFUND`
- `WEBHOOKS`

The contract uses exact integer minor-unit money, strict idempotency keys, organization-owned booking context, normalized provider statuses/failures, and capability checks. Provider implementations must not leak provider-specific response models into booking code. Online authorization accepts only a provider-issued payment-method reference; SF never accepts raw card data through this server contract.

`ManualPaymentProvider` is a real offline-payment recording adapter. It does not process cards, contact an external gateway, pretend to authorize funds, or advertise unsupported online capabilities. It supports recording staff-confirmed external/offline payments and refunds only after those money movements have happened outside SF.

## Stripe adapter

`StripePaymentProvider` is the first real online provider adapter. It talks to Stripe's HTTPS API without adding provider models to the booking domain and deliberately is not wired to a fake checkout page.

- Secrets are constructor-injected from the encrypted tenant integration boundary and are never accepted from browser input or logged.
- Authorization creates and confirms a Stripe PaymentIntent with `capture_method=manual`, the authoritative integer minor-unit amount, normalized currency, a provider-issued payment-method reference, SF organization/booking metadata, and the normalized SF idempotency key in Stripe's `Idempotency-Key` header.
- Capture operates on the exact PaymentIntent reference and authoritative booking amount.
- Refunds use the PaymentIntent reference, exact minor-unit amount, tenant/booking metadata, and a distinct idempotency key.
- Stripe `requires_capture`, `succeeded`, and `canceled` statuses normalize to SF `AUTHORIZED`, `PAID`, and `FAILED`; intermediate states remain `PENDING` until a verified provider result resolves them.
- HTTP/auth/rate-limit/card/provider failures normalize to the shared failure taxonomy. Timeouts and transport failures are retryable/ambiguous and must not be treated as proof that money did or did not move.
- Webhook verification uses the raw request payload, `Stripe-Signature` timestamp plus `v1` HMAC-SHA256 signatures, timing-safe comparison, and a bounded timestamp tolerance. Signature verification exists at the adapter boundary; webhook ingestion/persistence is still pending.

`loadStripePaymentIntegration` resolves the active organization-scoped Stripe integration and decrypts credentials only on the server. Stripe operations also require the configured integration capability (`payment-authorize` or `payment-capture`) in addition to the adapter capability, so tenant configuration cannot be bypassed by the provider implementation.

## Stripe authorization and capture persistence

`authorizeStripeBookingPayment` and `captureStripeBookingPayment` are the server-side application-service boundaries for the first real online payment lifecycle.

Authorization:

1. organization and actor identity are server supplied and `payment:manage` is required before provider credential resolution;
2. the booking is read by `(bookingId, organizationId)`, must be confirmed, and supplies the authoritative currency and immutable total;
3. only a provider-issued Stripe PaymentMethod reference is accepted; raw card data is never accepted;
4. the tenant Stripe integration must be active and advertise `payment-authorize`;
5. Stripe is called with the SF idempotency key and authoritative booking money;
6. the provider result is checked for provider code, currency, and exact amount before persistence;
7. the normalized `AUTHORIZATION` ledger row, booking payment-state transition, and audit event are persisted under tenant-scoped advisory locks in one serializable PostgreSQL transaction.

Capture:

1. `payment:manage` and tenant-scoped booking access are required;
2. the booking must still be confirmed and have a successful Stripe authorization matching the immutable booking total;
3. the Stripe PaymentIntent reference comes from the persisted authorization row, never the browser;
4. the tenant integration must advertise `payment-capture`;
5. successful provider proof moves the booking to `PAID`; pending or failed capture results remain ledger-visible while the booking stays `AUTHORIZED`, because a failed capture does not prove the underlying authorization disappeared;
6. one capture lifecycle row is allowed for the Stripe PaymentIntent under the current full-capture model.

Online request fingerprints are stored as SHA-256 hex values on authorization/capture ledger rows. The fingerprint covers the operation plus authoritative booking inputs and, for authorization, the normalized PaymentMethod reference. The PaymentMethod itself is not persisted. This allows exact idempotent retries to return the already persisted result after the booking state has advanced, while rejecting reuse of the same SF idempotency key with changed inputs. Existing manual ledger rows keep this field null.

A checked-in migration adds `requestFingerprint` as nullable `CHAR(64)` plus a database format constraint. It must be exercised against the guarded disposable PostgreSQL target before database validation can be claimed.

There is intentionally still no browser-facing Stripe payment route or fake checkout surface. Customer payment collection must first use a real Stripe client-side tokenization/PaymentMethod creation boundary and must never treat a browser redirect as payment proof.

## Persisted transaction ledger

`PaymentTransaction` is the normalized payment ledger boundary. Each row stores:

- `organizationId` and `bookingId`;
- a tenant-unique idempotency key;
- optional one-way request fingerprint for online operations;
- normalized transaction kind/status;
- provider code and provider reference;
- exact currency and integer minor-unit amount;
- creation time.

The database enforces a composite `(bookingId, organizationId)` foreign key to `hospitality_bookings`, so a transaction cannot be attached to another tenant's booking even if application scoping regresses.

Provider-reference uniqueness is lifecycle-aware: `(organizationId, providerCode, providerReference, kind)` is unique, with a separate non-unique lookup index on `(organizationId, providerCode, providerReference)`. This permits a Stripe PaymentIntent to appear once as an `AUTHORIZATION` and once as a `CAPTURE` while preventing duplicate persistence of the same lifecycle kind.

Booking guest persistence has the same database ownership protection: `hospitality_booking_guests(bookingId, organizationId)` references the tenant-owned booking key.

## Manual/offline payment workflow

`recordManualOfflinePayment` is the authorized offline workflow. It derives amount/currency from the immutable confirmed booking, serializes idempotency/booking/reference scopes, records a successful manual ledger row, updates the booking to `PAID`, and writes a reference-minimized audit event atomically. Exact retries return the existing row; changed retries, duplicate references, cross-tenant bookings, already-paid bookings, and non-confirmed bookings are rejected.

## Manual/offline refund workflow

`recordManualOfflineRefund` records a refund that was actually performed outside SF. It never pretends SF sent money through a bank or gateway.

- `payment:manage` and active server-derived organization context are required.
- The booking must be confirmed and currently `PAID` or `PARTIALLY_REFUNDED`.
- A successful manual payment must exist in the same tenant and booking.
- Existing successful manual refunds are summed under the booking lock to derive remaining refundable balance.
- `amountMinor` is optional; omission means the full remaining amount.
- Partial refunds move the booking to `PARTIALLY_REFUNDED`; exhausting the paid amount moves it to `REFUNDED`.
- The refund ledger write, booking state transition, and safe audit event commit atomically.

The current manual workflow assumes one successful manual source payment. Future online/provider refunds must relate refunds to the exact provider authorization/capture rather than infer from the booking ledger.

## Authenticated API boundary

- `POST /api/payments/manual` records an offline payment with `{ bookingId, idempotencyKey, reference }` and requires same-origin protection plus `payment:manage`.
- `POST /api/payments/manual/refunds` records an offline refund with `{ bookingId, idempotencyKey, reference, amountMinor? }`.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped payment history and requires `payment:read`.

BigInt monetary values are serialized as decimal strings at the HTTP boundary.

There is intentionally no Stripe checkout/payment API route yet. The server-side Stripe authorization/capture services are internal application boundaries until a real customer-owned payment collection surface is implemented.

## Permissions

- Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`.
- `STAFF` receives `payment:read` only.
- `CUSTOMER` receives no internal payment-ledger capability.

A future customer payment journey must introduce its own ownership/self-service authorization boundary rather than weaken internal permissions.

## Validation and remaining work

The standard payment unit glob now includes focused Stripe persistence tests for deterministic request fingerprints and booking-state mapping. Existing Stripe adapter coverage verifies request construction, exact capture/refund requests, idempotency headers, provider money mismatches, normalized failures, reference validation, and webhook signature/timestamp verification without contacting Stripe.

The checked-in disposable PostgreSQL payment suite covers the manual payment/refund persistence workflow. Stripe authorization/capture persistence still needs dedicated disposable PostgreSQL integration coverage for tenant denial, exact retry, changed retry, provider-reference reuse, pending/failure states, successful capture, and audit minimization.

The payment-request-fingerprint migration and earlier provider-reference lifecycle migration must both be exercised against the disposable PostgreSQL target before claiming live database verification.

Do not claim database validation passed unless `npm run test:database` ran against the guarded disposable PostgreSQL target.

Still open: customer-facing Stripe payment collection, failed/ambiguous-result reconciliation, verified webhook ingestion/persistence, online refunds, receipts/invoices, PayPal, and live PostgreSQL validation. Browser success/redirect state must never be accepted as proof of payment.
