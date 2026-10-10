# Manual payment reference authority

SF reserves the `sf_claim_*` prefix for unresolved internal payment claims. These are never proof of a completed external payment or refund.

The shared `normalizeManualPaymentReference` entry boundary rejects the reserved prefix before staff-recorded hospitality or rental offline payment/refund references can be persisted. Otherwise a valid-looking staff reference could create successful ledger evidence that downstream receipt and reconciliation readers correctly refuse to trust.

The normalizer still enforces the existing bounded printable-character contract and preserves legitimate external references. This guard does not reinterpret or silently repair historical payment rows.

Regression coverage: `src/server/payments/manual-payment-reserved-claim.test.ts`. Full Node 24 and disposable PostgreSQL validation remain outstanding. GitHub Actions are not used.
