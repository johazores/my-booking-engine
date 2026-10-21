# Rental financial input-error classification

## Implemented bond and booking-price HTTP boundaries

Authenticated rental security-bond **collection and release** mutation routes now distinguish application-owned input errors from arbitrary failures using `isRentalFinancialInputValidationError`. The helper recognizes `PaymentInputValidationError`, `PricingValidationError`, and `TenantIdentifierValidationError`, rather than matching words in thrown error messages.

Permission denials, tenant-scoped resource unavailability, and durable commercial conflicts retain their separate bounded redirect statuses. Unexpected infrastructure, adapter, database, or programming errors are classified as server failures, even when their messages contain "invalid", "required", or "reference". Raw thrown messages are not returned in redirects.

The bond service still enforces authenticated tenant and actor scope, server-derived settlement authority, manual-provider evidence, idempotency, audit, and database integrity. This change only hardens the HTTP presentation boundary.

The booking-price manual payment and refund routes use the same typed predicate and retain their explicit permission, conflict, and tenant-resource-unavailable responses. Their service amount parsers now raise `PaymentInputValidationError` for non-string or non-positive requested amounts; the existing `PricingValidationError` covers invalid currency-aware money syntax. The route preflight authenticates and selects the tenant before reading form data, and the service independently enforces `payment:manage` and tenant-owned booking scope. An unknown exception, regardless of message text, remains a server failure.

## Remaining related scope

Other rental financial mutation routes (bond forfeiture, damage settlement payment/refund, and late-return settlement payment/refund) still require the same typed-error treatment. They are **not** claimed complete here. Their current message-based classification can mislabel arbitrary infrastructure failures as user validation errors; do not claim those routes hardened until their source and regression coverage are updated.

## Verification

`src/server/payments/rental-financial-input-validation.test.ts` tests the predicate. `scripts/rental-security-bond-error-classification-contract.test.mjs` guards both bond routes, and `scripts/rental-booking-price-error-classification-contract.test.mjs` guards booking-price payment/refund routes and their typed amount parsing. Run `npm run validate` under Node 24.20+ and `npm run test:database` only against a deliberately disposable PostgreSQL database. GitHub Actions are not used.
