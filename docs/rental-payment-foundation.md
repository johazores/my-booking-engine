# Rental payment foundation

SF supports a narrow production settlement boundary for confirmed rental bookings: authorized staff can record a real full-value manual/offline payment and later record a real manual/offline refund against the remaining settlement source. This uses the existing provider adapter contract and keeps payment evidence separate from immutable rental booking commercial evidence.

This is not a deposit workflow and is not an online checkout workflow.

## Persisted evidence

`RentalPaymentTransaction` is tenant-owned append-only settlement evidence linked to `RentalBooking` by the composite `(bookingId, organizationId)` foreign key. It stores:

- tenant and rental booking identity;
- server-derived idempotency key;
- payment/refund kind and resolution status;
- provider code and provider reference;
- refund source-provider reference when applicable;
- exact currency and minor-unit amount;
- creation time.

Database checks reject non-positive money, invalid currency/provider identity, malformed request fingerprints, and refund rows without source attribution. Tenant-scoped uniqueness protects both idempotency replay and provider-reference identity so two booking writes cannot claim the same manual evidence concurrently.

Idempotent replay is not accepted from the key alone. The service re-resolves the tenant booking and verifies the existing append-only row still matches the expected operation, successful status, provider/reference shape, booking currency, authoritative amount where applicable, and reconciled settlement/source evidence before returning an idempotent success. A conflicting row fails closed.

## Bounded complete settlement history

Settlement decisions need the complete payment/refund chain rather than only the staff-visible page. `readRentalPaymentSettlementHistory` loads that chain through bounded 100-row cursor pages, with `(organizationId, bookingId)` repeated on every query. No settlement or cancellation path uses an unbounded `findMany` collection read.

The current manual rental contract has a 1,000-transaction reconciliation safety limit. Exceeding it fails closed as unreconciled/conflicting settlement rather than making a financial decision from a truncated history. The current staff workflow normally produces only one full payment and its remaining refund; future split tenders, partial-refund automation, or new providers must deliberately revisit this limit and reconciliation strategy.

The staff payment read model computes settlement and the visible paginated history inside one `RepeatableRead` transaction so count, reconciliation evidence, and the returned page share a consistent database snapshot.

## Manual full payment

`recordRentalManualOfflinePayment` requires `payment:manage`, validates tenant and actor identifiers, normalizes the real-world reference through `ManualPaymentProvider`, derives idempotency server-side from operation + booking + normalized reference, and serializes on the existing rental booking mutation lock.

The transaction then:

1. resolves the booking inside the authenticated tenant before accepting either a new write or an idempotent replay;
2. derives payment state from bounded complete tenant-owned transaction history;
3. only permits a new payment from `UNPAID`;
4. locks and rejects duplicate manual references inside the tenant;
5. requires the provider result to match the authoritative booking currency and full accepted amount;
6. appends a successful `RentalPaymentTransaction`;
7. writes a secret-free audit event.

Expected serialization, uniqueness, relation, and durable-constraint races are normalized through the shared rental write classifier. Serialization/idempotency races are retried at most three transaction attempts; exhausted or constraint-rejected writes fail closed as rental payment conflicts, while unknown infrastructure/programming errors still surface unchanged.

No browser-provided amount, tenant, actor, or idempotency authority is accepted.

## Manual refund

`recordRentalManualOfflineRefund` also requires `payment:manage` and the same rental booking lock. It only creates a new refund for a confirmed booking whose settlement is `PAID` or `PARTIALLY_REFUNDED`.

The existing refund-allocation domain derives the next refundable source from bounded complete transaction history. The current staff route does not accept an amount, so it refunds the remaining amount of that source and persists explicit `sourceProviderReference` attribution.

An idempotent refund replay remains valid after a later terminal booking cancellation only when its retained successful refund row, source payment, tenant currency, and complete settlement still reconcile to `REFUNDED`. It does not bypass evidence checks just because the deterministic idempotency key exists.

This is evidence for a real refund performed outside SF. It is not a synthetic provider call.

## Cancellation financial guard

Rental cancellation remains an inventory lifecycle mutation, but it now fails closed while settled money remains, payment history is unreconciled, or complete settlement history exceeds the current reconciliation safety limit. Staff must record the real refund before cancellation releases physical inventory.

The application service derives settlement from the same bounded history reader under the rental booking lock. The database migration adds an independent cancellation guard for the currently supported rental payment contract: unresolved rows, unsupported successful provider/kind combinations, or non-zero net manual settlement block `CONFIRMED -> CANCELLED`.

That database guard is intentionally conservative. Future Stripe rental payments, deposits, authorizations, fees, chargebacks, or other settlement kinds must extend the payment state machine and database contract before cancellation can accept them.

## Staff interaction

The authenticated rental booking detail renders settlement state and tenant-scoped transaction history to actors with `payment:read`.

Actors with `payment:manage` can:

- record a full manual/offline payment while the confirmed booking is unpaid;
- record the remaining manual/offline refund while confirmed settled money remains.

The POST routes derive organization and actor from authenticated server context and only accept the external reference from the form. Cancellation UI is withheld unless payment history is readable, reconciled, and net settled money is zero; the cancellation service independently enforces the same financial safety condition.

## Deliberate boundaries

This foundation does not implement deposits, card authorization, Stripe rental checkout, customer self-service, split/tendered payments, chargebacks, cancellation fees, damage/security bonds, pickup/return settlement, invoices, or external accounting synchronization.

Those remain separate commercial contracts. No placeholder route or dead payment action is exposed for them.

## Validation

- `src/server/payments/rental-payment-domain.test.ts` covers derived unpaid/paid/partial-refund/refunded states, fail-closed reconciliation, and deterministic server idempotency.
- `src/server/payments/rental-payment-history.test.ts` covers bounded cursor pagination and fail-closed reconciliation when the safety limit is exceeded.
- `scripts/rental-payment-foundation-source-contract.test.mjs` protects tenant ownership, schema/migration constraints, booking-lock serialization, exact replay evidence, bounded complete history, provider-adapter use, staff-route authority, cancellation settlement guards, and the no-deposit/no-online-checkout boundary.
- `src/server/payments/rental-payment.integration.ts` is registered in the guarded disposable-PostgreSQL runner and covers real payment/refund persistence, cross-tenant denial, cancellation blocking before refund, append-only evidence, and cancellation after full refund.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used for this validation.
