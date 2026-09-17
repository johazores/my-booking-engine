# Rental payment request evidence

The rental payment foundation supports staff-recorded manual/offline full booking-price payment plus source-attributed manual/offline partial or full refunds. Durable request evidence binds each new `RentalPaymentTransaction` to the exact server-authorized operation without enabling online payment or synthetic provider behavior.

## Durable request fingerprint

New settlement rows persist a SHA-256 `requestFingerprint` produced by `buildRentalPaymentRequestFingerprint`. The versioned `rental-payment-request-v1` fingerprint binds organization, booking, deterministic operation idempotency, transaction kind, provider code, provider reference, refund source-provider reference when applicable, currency, and exact minor-unit amount.

The application computes the fingerprint from authenticated tenant/actor context, retained booking authority, normalized provider evidence, and the server-derived refund plan. The browser never supplies the fingerprint, settlement source, tenant, actor, provider, currency, minor-unit amount, or idempotency key.

For the full manual booking-price payment, SF derives the expected fingerprint from the authoritative booking total and normalized external reference before accepting provider evidence. The adapter result must rebuild to that exact fingerprint before persistence.

For a manual refund, staff may provide a major-unit refund amount together with the real external refund reference. The server converts that amount with the shared currency-aware money parser, then bounded settlement reconciliation selects the exact retained source and verifies the requested amount does not exceed its remaining refundable balance. The exact source and exact minor-unit amount are bound into the expected fingerprint before provider-adapter I/O. The returned provider code, refund reference, source reference, currency, and amount must rebuild to the same fingerprint before persistence.

## Idempotent replay

Payment and refund replay always re-read the tenant booking and bounded complete settlement history. A retained fingerprint must exactly match the expected operation evidence. Rows predating request fingerprints may retain `requestFingerprint = NULL`; those legacy rows remain replayable only through the existing exact-field checks plus complete settlement/source reconciliation. New rows cannot use that legacy path.

A partial refund remains replayable while the booking is still `PARTIALLY_REFUNDED`, after subsequent refunds move settlement to `REFUNDED`, and after a later cancellation, provided its exact retained row, source payment, fingerprint, and complete settlement evidence still reconcile. If a caller supplies an amount on replay, it must equal the retained refund amount. An idempotency key alone is never sufficient authority.

The bounded settlement reader also validates deterministic operation idempotency, request fingerprints when present, database-authored timestamps, and refund/source chronology before any payment, refund, cancellation, or staff settlement decision consumes the history.

## PostgreSQL defense in depth

The request-evidence migration requires a lowercase 64-hex fingerprint and the enabled operation-specific idempotency namespace (`rental:manual-payment:*` or `rental:manual-refund:*`). The follow-up chronology migration assigns `createdAt` from PostgreSQL `clock_timestamp()` on every insert so application clocks and caller-supplied timestamps cannot author commercial chronology.

The database does not reproduce the application SHA-256 payload contract because this workflow does not require a PostgreSQL cryptographic extension. Exact fingerprint semantics remain application-owned and replay-validated; PostgreSQL independently enforces evidence shape, operation namespace, confirmed tenant booking ownership, booking currency, full-value manual funding, refund source ownership, cumulative over-refund prevention, tenant provider-reference uniqueness, and append-only evidence.

## Scope

This capability does not add Stripe rental checkout, deposits, split tenders, partial booking-price funding, card authorization, fees, chargebacks, security bonds, delivery, customer self-service, or automatic refund policy. It only allows an authorized staff member to retain the exact amount of a real manual/offline refund that already occurred.

## Validation

- `src/server/payments/rental-payment-domain.test.ts` protects deterministic fingerprinting and settlement state.
- `src/server/payments/payment-refund-execution-domain.test.ts` protects requested partial-refund allocation.
- `src/server/payments/rental-payment-history.test.ts` protects bounded evidence validation and chronology.
- `scripts/rental-payment-request-evidence-source-contract.test.mjs` protects request binding, requested-amount authority, replay behavior, database evidence guards, and integration coverage.
- `src/server/payments/rental-payment.integration.ts` exercises persisted fingerprints, partial refund replay before and after later settlement transitions, cancellation blocking until net zero, and post-cancellation replay.

Full repository validation remains `npm run validate` on the Node version declared in `package.json`. Live migration/database validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
