# Payments

## Status

SF now has a provider-independent payment contract foundation and an explicit manual/offline adapter boundary. No payment API, persistence, checkout UI, Stripe/PayPal integration, webhook processing, refund workflow, receipt/invoice flow, or browser success handling is exposed yet. Those remain incomplete and must not be presented as working payment functionality.

## Provider contract

`src/server/payments/payment-provider.ts` defines the normalized internal contract that future payment providers must implement without leaking provider-specific request/response models into booking logic.

The contract models capabilities explicitly:

- `OFFLINE_RECORDING`
- `AUTHORIZE`
- `CAPTURE`
- `REFUND`
- `WEBHOOKS`

Operations are optional because providers do not all support the same lifecycle. Application code must check the advertised capability before invoking an operation instead of assuming every provider supports authorization, capture, refund, or webhooks.

Provider failures use normalized application-level classifications such as invalid request, authentication failure, rate limiting, provider unavailability, timeout, decline, duplicate operation, unsupported operation, and unknown failure. Provider adapters should map their native errors into this boundary without exposing credentials or sensitive raw payloads.

## Exact money and idempotency

Payment operation context requires server-owned organization and booking UUIDs, a strict 8-120 character idempotency key, a three-letter normalized currency, and an exact non-negative integer minor-unit amount represented as `bigint` internally.

The payment domain deliberately does not use JavaScript floating-point numbers for authoritative money. Future persisted transactions and external-provider requests must derive their amount from the immutable server booking snapshot rather than trusting browser-submitted totals.

Payment idempotency is a first-class contract requirement. Persistence and provider adapters must reuse the same logical operation identity across retryable failures so lost responses do not create duplicate charges, captures, or refunds.

## Manual/offline adapter

`src/server/payments/manual-payment-provider.ts` advertises only `OFFLINE_RECORDING`. It accepts an explicit bounded reference such as a bank-transfer or cash-receipt reference and returns a normalized paid result while preserving exact money.

The adapter intentionally does not advertise authorization, capture, refund, or webhook capabilities. It is not wired to an API or UI yet, because an offline payment must only become commercially effective after an authenticated, authorized, tenant-scoped payment service persists the transaction and updates booking payment state atomically. The current adapter alone is therefore not presented as a completed payment workflow.

No card number, CVV, bank credential, token, or provider secret field exists in this manual boundary.

## Security rules for the next slice

The payment application/service layer must:

1. derive tenant identity from the authenticated server session;
2. require explicit payment permissions;
3. load the tenant-owned booking and immutable server price snapshot;
4. refuse browser-supplied authoritative totals;
5. persist transaction history and provider references with tenant-safe relationships;
6. serialize idempotent commercial writes;
7. update booking payment state from persisted provider outcomes rather than redirects;
8. audit commercial state changes without payment credentials or sensitive provider payloads; and
9. treat timeouts and lost responses as ambiguous until reconciled rather than blindly retrying a charge.

## Validation coverage

`src/server/payments/payment-provider.test.ts` covers normalized UUID/idempotency boundaries, exact minor-unit money, invalid currency/amount rejection, capability enforcement, manual-provider capability limits, offline reference validation, and exact money preservation.

Full execution still requires the repository Node 24 runtime. Database-backed payment tests will be added when the persisted transaction/service boundary exists.

## Next dependency

The next payment slice is tenant-scoped payment persistence and an authorized application service for idempotent manual/offline payment recording against the immutable booking total. Only after that boundary is proven should the authenticated booking-management UI expose manual payment recording. Stripe should follow behind the same contract, including verified webhook handling and reconciliation before any browser redirect can affect payment state.
