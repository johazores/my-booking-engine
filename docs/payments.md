# Payments

SF keeps booking state and payment state separate. Provider-specific behavior stays behind normalized payment adapters; application services own tenant scope, authorization, idempotency, persistence, booking-state updates, and audit history.

## Implemented foundation

`src/server/payments/payment-provider.ts` defines the provider-independent contract and explicit capabilities:

- `OFFLINE_RECORDING`
- `AUTHORIZE`
- `CAPTURE`
- `REFUND`
- `WEBHOOKS`

The contract uses exact integer minor-unit money, strict idempotency keys, organization-owned booking context, normalized provider statuses/failures, and capability checks. Provider implementations must not leak provider-specific response models into booking code.

`ManualPaymentProvider` is a real offline-payment recording adapter. It does not process cards, contact an external gateway, pretend to authorize funds, or advertise unsupported capabilities. Its only supported operation is recording a staff-supplied external/offline reference against a server-authoritative booking amount.

## Persisted transaction ledger

`PaymentTransaction` is the normalized immutable payment ledger boundary. Each row stores:

- `organizationId` and `bookingId`;
- a tenant-unique idempotency key;
- normalized transaction kind/status;
- provider code and provider reference;
- exact currency and integer minor-unit amount;
- creation time.

The migration enforces a composite `(bookingId, organizationId)` foreign key to `hospitality_bookings`, so a transaction cannot be attached to another tenant's booking even if application scoping regresses. Provider references are unique per organization/provider to prevent the same external receipt/reference being recorded twice.

Booking guest persistence has the same database ownership protection: `hospitality_booking_guests(bookingId, organizationId)` now references the tenant-owned booking key.

## Manual/offline payment workflow

`recordManualOfflinePayment` is the first authorized application payment workflow.

1. The organization and actor come from authenticated server context.
2. `payment:manage` is required; browser-supplied tenant identity is not accepted.
3. The booking is loaded by both booking ID and organization ID.
4. Only a confirmed booking in an unpaid/failed payment state can receive a new offline payment.
5. Currency and amount come exclusively from the immutable booking price snapshot. The API accepts no payment amount.
6. The service serializes idempotency, booking, and manual-reference scopes inside a serializable PostgreSQL transaction.
7. The manual adapter records the normalized operation using the server booking total.
8. A successful ledger row, booking `paymentStatus = PAID`, and safe audit event commit together.
9. Exact retries return the existing transaction. Reusing the idempotency key with different input, submitting a second payment for an already-paid booking, or reusing a manual reference is rejected.

The audit event deliberately omits the manual provider reference and any payment-sensitive payload. The transaction ledger retains the operational provider reference needed for reconciliation.

## Authenticated API boundary

- `POST /api/payments/manual` records an offline payment with `{ bookingId, idempotencyKey, reference }`. It requires authenticated active-organization context, same-origin write protection, and `payment:manage`.
- `GET /api/payments/transactions?bookingId=...` returns paginated tenant-scoped payment history for a booking and requires `payment:read`.

BigInt monetary values are serialized as decimal strings at the HTTP boundary.

## Permissions

- Organization `ADMIN` and `MANAGER` roles receive `payment:read` and `payment:manage`.
- `STAFF` receives `payment:read` only.
- `CUSTOMER` receives no internal payment-ledger capability.

A future customer payment journey must introduce its own ownership/self-service boundary instead of weakening internal permissions.

## Validation and future providers

The disposable PostgreSQL suite includes payment coverage for permission enforcement, cross-tenant denial, immutable booking totals, successful state transition, exact retry behavior, changed-retry rejection, transaction history, audit minimization, and the composite tenant/booking foreign key.

Do not claim database validation passed unless `npm run test:database` ran against the guarded disposable PostgreSQL target.

Stripe, PayPal, authorization/capture, refunds, webhook ingestion, ambiguous-result reconciliation, receipts/invoices, and customer-facing online payment UI are not implemented yet. When a real online provider is added, it must implement this adapter contract, verify signed webhooks where supported, persist provider references, make every write idempotent, treat timeout/unknown outcomes as ambiguous until reconciled, and never treat a browser success redirect as proof of payment.
