# Rental payment request evidence

The rental payment foundation supports only staff-recorded manual/offline full payment and manual/offline refund evidence. This hardening binds each new rental settlement row to the exact server-authorized request that produced it without expanding that commercial contract.

## Durable request fingerprint

New `RentalPaymentTransaction` rows now persist a SHA-256 `requestFingerprint` produced by `buildRentalPaymentRequestFingerprint`.

The fingerprint is versioned with the `rental-payment-request-v1` domain separator and binds:

- organization identity;
- rental booking identity;
- deterministic rental payment idempotency key;
- operation kind (`OFFLINE_PAYMENT` or `REFUND`);
- provider code;
- provider reference;
- refund source-provider reference when applicable;
- currency;
- exact minor-unit amount.

The application computes the fingerprint only from server-derived booking authority, the normalized manual provider result, and the refund plan. The browser does not submit the fingerprint, amount, source payment, tenant, actor, or idempotency key.

For a new manual payment, the provider result must rebuild to the same request fingerprint as the pre-provider authoritative request before the transaction is inserted. This catches an adapter result that unexpectedly changes durable payment identity even when the coarse amount/currency checks still pass.

## Idempotent replay

Payment and refund replay still re-read the tenant-owned booking and bounded complete settlement history. When a retained row has a request fingerprint, replay additionally requires an exact match to the fingerprint rebuilt from the expected operation evidence.

Rows created before this migration may legitimately have `requestFingerprint = NULL`. Those legacy rows remain replayable only through the existing exact field checks plus full settlement/source reconciliation. New rows cannot use that legacy path.

## PostgreSQL defense in depth

The migration adds an insert-only authority guard for future rental payment rows. Before the existing rental settlement trigger executes, PostgreSQL requires:

- a lowercase 64-hex request fingerprint;
- the enabled operation-specific idempotency namespace and 48-hex digest shape (`rental:manual-payment:*` or `rental:manual-refund:*`);
- `createdAt` to remain the database-authored transaction timestamp rather than caller-authored evidence.

The database intentionally does not reproduce the application SHA-256 payload contract because the repository does not require a PostgreSQL cryptographic extension for this workflow. Exact fingerprint semantics remain application-owned and replay-validated; PostgreSQL independently enforces required evidence presence, shape, operation namespace, and database-authored chronology.

The pre-existing insert guard still enforces confirmed tenant booking ownership, exact booking currency/full-payment money, manual-provider-only successful evidence, refund source ownership and over-refund prevention, and tenant-wide provider-reference uniqueness. The append-only guard still prevents later mutation or deletion.

## Scope

This change does not add Stripe rental checkout, deposits, split tenders, card authorization, fees, chargebacks, security bonds, delivery, customer self-service, or any synthetic provider behavior. It only hardens the already-supported manual rental settlement evidence boundary.

## Validation

- `src/server/payments/rental-payment-domain.test.ts` covers deterministic fingerprinting and sensitivity to tenant, idempotency, source, operation, and exact money.
- `scripts/rental-payment-request-evidence-source-contract.test.mjs` protects service persistence/replay checks, migration guards, integration coverage, and the legacy-compatibility boundary.
- `src/server/payments/rental-payment.integration.ts` is registered in the guarded disposable PostgreSQL suite and now exercises missing fingerprint, malformed operation idempotency, caller-authored creation time, persisted fingerprints, replay, settlement, refund, append-only evidence, and cancellation safety.

Full repository validation remains `npm run validate` on the Node version declared in `package.json`. Live migration/database validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
