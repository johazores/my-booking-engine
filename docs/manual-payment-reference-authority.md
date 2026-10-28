# Manual payment reference authority

SF reserves the `sf_claim_*` prefix for unresolved internal payment claims. These are never proof of a completed external payment or refund.

The shared `normalizeManualPaymentReference` entry boundary rejects the reserved prefix before staff-recorded hospitality or rental offline payment/refund references can be persisted. Otherwise a valid-looking staff reference could create successful ledger evidence that downstream receipt and reconciliation readers correctly refuse to trust.

The normalizer still enforces the existing bounded printable-character contract and preserves legitimate external references. This guard does not reinterpret or silently repair historical payment rows.

Regression coverage: `src/server/payments/manual-payment-reserved-claim.test.ts`. Full Node 24 and disposable PostgreSQL validation remain outstanding. GitHub Actions are not used.

## Base booking idempotency ownership

Normal hospitality manual payment and refund replays must resolve to the exact base booking operation, not an amendment-owned transaction with the same tenant, booking, kind, idempotency key, and external reference. Both replay paths require null commercial amendment ownership, a definitively SUCCEEDED manual operation, and the original booking, kind, provider, and reference. Explicit refund amounts must still match; an omitted refund amount retains the existing replay behavior. New base booking manual writes explicitly persist null amendment attribution.

Amendment-owned manual settlement and recovery continue to use their dedicated server-authorized services and fingerprints. The pure replay predicate is covered by src/server/payments/manual-base-booking-replay-domain.test.ts; the existing disposable-PostgreSQL payment integration suite also asserts null attribution for ordinary writes. This does not change Stripe retries or permit cross-tenant reuse of external references.

The focused predicate tests were executed with local Node 22 experimental type stripping. Full Node 24, Prisma, PostgreSQL, lint, typecheck, and production build validation remain outstanding in the provisioned repository environment. No GitHub Actions are used.
