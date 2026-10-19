# Rental financial input-error classification

## Implemented bond HTTP boundary

Authenticated rental security-bond **collection and release** mutation routes now distinguish application-owned input errors from arbitrary failures using `isRentalFinancialInputValidationError`. The helper recognizes `PaymentInputValidationError`, `PricingValidationError`, and `TenantIdentifierValidationError`, rather than matching words in thrown error messages.

Permission denials, tenant-scoped resource unavailability, and durable commercial conflicts retain their separate bounded redirect statuses. Unexpected infrastructure, adapter, database, or programming errors are classified as server failures, even when their messages contain "invalid", "required", or "reference". Raw thrown messages are not returned in redirects.

The bond service still enforces authenticated tenant and actor scope, server-derived settlement authority, manual-provider evidence, idempotency, audit, and database integrity. This change only hardens the HTTP presentation boundary.

## Remaining related scope

Other rental financial mutation routes (booking-price manual payments/refunds, bond forfeiture, damage settlement payment/refund, and late-return settlement payment/refund) require the same typed-error treatment. They are **not** claimed complete here. The booking-price amount parser also needs four generic input throws converted to `PaymentInputValidationError` before those routes adopt this predicate. Do not broaden the completed scope until the routes, service errors, tests, and documentation are all updated and validated together.

## Verification

`src/server/payments/rental-financial-input-validation.test.ts` tests the predicate. `scripts/rental-security-bond-error-classification-contract.test.mjs` guards both updated routes. Run `npm run validate` under Node 24.20+ and `npm run test:database` only against a deliberately disposable PostgreSQL database. GitHub Actions are not used.
