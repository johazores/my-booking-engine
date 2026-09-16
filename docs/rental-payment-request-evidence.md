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

For a new manual payment, SF derives the expected fingerprint from the authoritative booking total and normalized external reference before accepting provider evidence. The provider result must rebuild to that exact fingerprint before the transaction is inserted.

For a new manual refund, SF now applies the same two-sided authority check. After bounded settlement reconciliation selects the exact refundable source and remaining amount, the service builds the expected refund fingerprint before invoking the provider adapter. The returned provider code, refund reference, source payment reference, currency, and amount must rebuild to that same fingerprint before any refund row is persisted. This prevents an adapter result from changing durable refund identity after the server has authorized a specific refund plan.

## Idempotent replay

Payment and refund replay still re-read the tenant-owned booking and bounded complete settlement history. When a retained row has a request fingerprint, replay additionally requires an exact match to the fingerprint rebuilt from the expected operation evidence.

Rows created before this migration may legitimately have `requestFingerprint = NULL`. Those legacy rows remain replayable only through the existing exact field checks plus full settlement/source reconciliation. New rows cannot use that legacy path.

A completed refund remains replayable after the booking is later cancelled only when the retained refund, its source payment, request fingerprint when present, and complete settlement evidence still reconcile. Replay never creates a second provider record and never bypasses tenant scope merely because the deterministic key exists.

The bounded settlement-history reader applies the same evidence checks before any payment, refund, cancellation, or staff settlement decision consumes the history. For enabled manual payment/refund rows it rebuilds the deterministic idempotency key from booking + operation + retained provider reference, and when a request fingerprint is present it rebuilds and verifies the exact fingerprint. A mismatched key or fingerprint therefore makes the entire settlement history incomplete and fails the caller closed. Legacy null fingerprints remain readable only when their deterministic idempotency evidence is intact.

## PostgreSQL defense in depth

The request-evidence migration adds an insert-only authority guard for future rental payment rows. PostgreSQL requires:

- a lowercase 64-hex request fingerprint;
- the enabled operation-specific idempotency namespace and 48-hex digest shape (`rental:manual-payment:*` or `rental:manual-refund:*`).

A follow-up chronology migration keeps the same trigger contract but makes the database the final author of settlement insertion time. The trigger now assigns `createdAt` from PostgreSQL `clock_timestamp()` on every insert. Caller-supplied `createdAt` values are overwritten rather than accepted as commercial chronology.

This is intentionally different from comparing `createdAt` with `CURRENT_TIMESTAMP`. PostgreSQL `CURRENT_TIMESTAMP` is the transaction-start time, while a serializable rental settlement transaction may do authorization, locking, reconciliation, and provider-adapter work before the evidence row is inserted. `clock_timestamp()` records the database wall clock at that actual insert boundary and cannot be shifted by an application-node clock or a caller-provided timestamp.

The database intentionally does not reproduce the application SHA-256 payload contract because the repository does not require a PostgreSQL cryptographic extension for this workflow. Exact fingerprint semantics remain application-owned and replay-validated; PostgreSQL independently enforces required evidence presence, shape, operation namespace, and database-authored chronology.

The pre-existing insert guard still enforces confirmed tenant booking ownership, exact booking currency/full-payment money, manual-provider-only successful evidence, refund source ownership and over-refund prevention, and tenant-wide provider-reference uniqueness. The append-only guard still prevents later mutation or deletion.

## Scope

This change does not add Stripe rental checkout, deposits, split tenders, card authorization, fees, chargebacks, security bonds, delivery, customer self-service, or any synthetic provider behavior. It only hardens the already-supported manual rental settlement evidence boundary.

## Validation

- `src/server/payments/rental-payment-domain.test.ts` covers deterministic fingerprinting and sensitivity to tenant, idempotency, source, operation, and exact money.
- `scripts/rental-payment-request-evidence-source-contract.test.mjs` protects service persistence/replay checks, pre-provider payment/refund authority binding, migration guards, database-authored insertion chronology, integration coverage, and the legacy-compatibility boundary.
- `scripts/rental-payment-database-clock-source-contract.test.mjs` specifically protects the follow-up PostgreSQL wall-clock chronology guard and documents its difference from transaction-start time.
- `src/server/payments/rental-payment.integration.ts` is registered in the guarded disposable PostgreSQL suite and exercises missing fingerprint, malformed operation idempotency, caller-supplied creation-time overwrite inside a rolled-back probe, persisted fingerprints, payment replay, refund replay before and after cancellation, settlement, append-only evidence, and cancellation safety.

Full repository validation remains `npm run validate` on the Node version declared in `package.json`. Live migration/database validation remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
