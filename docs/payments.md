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

The contract uses exact integer minor-unit money, strict idempotency keys, organization-owned booking context, normalized provider statuses/failures, and capability checks. Provider implementations must not leak provider-specific response models into booking code.

`ManualPaymentProvider` is a real offline-payment recording adapter. It does not process cards, contact an external gateway, pretend to authorize funds, or advertise unsupported online capabilities. It supports recording staff-confirmed external/offline payments and refunds only after those money movements have happened outside SF.

## Persisted transaction ledger

`PaymentTransaction` is the normalized immutable payment ledger boundary. Each row stores:

- `organizationId` and `bookingId`;
- a tenant-unique idempotency key;
- normalized transaction kind/status;
- provider code and provider reference;
- exact currency and integer minor-unit amount;
- creation time.

The migration enforces a composite `(bookingId, organizationId)` foreign key to `hospitality_bookings`, so a transaction cannot be attached to another tenant's booking even if application scoping regresses. Provider references are unique per organization/provider to prevent the same external receipt/reference being recorded twice.

Booking guest persistence has the same database ownership protection: `hospitality_booking_guests(bookingId, organizationId)` references the tenant-owned booking key.

## Manual/offline payment workflow

`recordManualOfflinePayment` is the first authorized application payment workflow.

1. The organization and actor come from authenticated server context.
2. `payment:manage` is required; browser-supplied tenant identity is not accepted.
3. The booking is loaded by both booking ID and organization ID.
4. Only a confirmed booking in an unpaid/failed payment state can receive a new offline payment.
5. Currency and amount come exclusively from the immutable booking snapshot. The API accepts no payment amount.
6. The service serializes idempotency, booking, and manual-reference scopes inside a serializable PostgreSQL transaction.
7. The manual adapter records the normalized operation using the server booking total.
8. A successful ledger row, booking `paymentStatus = PAID`, and safe audit event commit together.
9. Exact retries return the existing transaction. Reusing the idempotency key with different input, submitting a second payment for an already-paid booking, or reusing a manual reference is rejected.

## Manual/offline refund workflow

`recordManualOfflineRefund` records a refund that was actually performed outside SF. It never pretends that SF sent money through a bank or gateway.

- `payment:manage` and active server-derived organization context are required.
- The booking must be confirmed and currently `PAID` or `PARTIALLY_REFUNDED`.
- A successful manual payment must exist in the same tenant and booking.
- Existing successful refund ledger entries are summed inside the booking lock to derive the remaining refundable balance.
- `amountMinor` is optional. When omitted, SF records the full remaining refundable balance. When supplied, it must be an exact positive integer minor-unit string and cannot exceed the remaining balance.
- The refund reference is normalized, unique per organization/provider, and must differ from the original payment reference.
- Idempotency, booking, and manual-reference scopes are serialized in one PostgreSQL transaction.
- Partial refunds move the booking to `PARTIALLY_REFUNDED`; exhausting the paid amount moves it to `REFUNDED`.
- The refund ledger write, booking payment-state transition, and safe audit event commit atomically.
- Audit data intentionally excludes both the original payment reference and refund reference.

The current manual workflow assumes the existing single successful manual payment model. Future multi-capture/provider refund flows must relate refunds to the exact provider transaction/capture instead of inferring from the booking ledger.

## Authenticated API boundary

- `POST /api/payments/manual` records an offline payment with `{ bookingId, idempotencyKey, reference }`. It requires authenticated active-organization context, same-origin write protection, and `payment:manage`.
- `POST /api/payments/manual/refunds` records an offline refund with `{ bookingId, idempotencyKey, reference, amountMinor? }`. The amount is a decimal integer minor-unit string when supplied; omission means refund the remaining manual balance.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped payment history for a booking and requires `payment:read`.

BigInt monetary values are serialized as decimal strings at the HTTP boundary.

## Permissions

- Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`.
- `STAFF` receives `payment:read` only.
- `CUSTOMER` receives no internal payment-ledger capability.

A future customer payment journey must introduce its own ownership/self-service boundary instead of weakening internal permissions.

## Validation and future providers

The payment unit suite covers exact money, malformed inputs, capability enforcement, manual payment normalization, manual refund normalization, and rejection of a refund reference that duplicates the source payment reference.

The checked-in disposable PostgreSQL payment suite covers payment permission enforcement, cross-tenant denial, immutable booking totals, successful payment state transition, exact retry behavior, changed-retry rejection, transaction history, audit minimization, and the composite tenant/booking foreign key. It also covers manual refund permission and tenant isolation, over-refund rejection, partial and full refund state transitions, exact refund retry, changed-retry rejection, duplicate refund references, post-full-refund rejection, refund ledger history, and refund audit-reference minimization.

Do not claim database validation passed unless `npm run test:database` ran against the guarded disposable PostgreSQL target.

Stripe, PayPal, online authorization/capture, provider-executed refunds, webhook ingestion, ambiguous-result reconciliation, receipts/invoices, and customer-facing online payment UI are not implemented yet. When a real online provider is added, it must implement this adapter contract, verify signed webhooks where supported, persist provider references, make every write idempotent, treat timeout/unknown outcomes as ambiguous until reconciled, and never treat a browser success redirect as proof of payment.
