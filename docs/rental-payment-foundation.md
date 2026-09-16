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

Database checks reject non-positive money, invalid currency/provider identity, malformed request fingerprints, and refund rows without source attribution. Tenant-scoped uniqueness protects idempotency replay.

## Manual full payment

`recordRentalManualOfflinePayment` requires `payment:manage`, validates tenant and actor identifiers, normalizes the real-world reference through `ManualPaymentProvider`, derives idempotency server-side from operation + booking + normalized reference, and serializes on the existing rental booking mutation lock.

The transaction then:

1. rejects cross-tenant or non-confirmed bookings;
2. derives payment state from the complete tenant-owned transaction history;
3. only permits payment from `UNPAID`;
4. locks and rejects duplicate manual references inside the tenant;
5. requires the provider result to match the authoritative booking currency and full accepted amount;
6. appends a successful `RentalPaymentTransaction`;
7. writes a secret-free audit event.

No browser-provided amount, tenant, actor, or idempotency authority is accepted.

## Manual refund

`recordRentalManualOfflineRefund` also requires `payment:manage` and the same rental booking lock. It only operates on a confirmed booking whose settlement is `PAID` or `PARTIALLY_REFUNDED`.

The existing refund-allocation domain derives the next refundable source from complete transaction history. The current staff route does not accept an amount, so it refunds the remaining amount of that source and persists explicit `sourceProviderReference` attribution.

This is evidence for a real refund performed outside SF. It is not a synthetic provider call.

## Cancellation financial guard

Rental cancellation remains an inventory lifecycle mutation, but it now fails closed while settled money remains or payment history is unreconciled. Staff must record the real refund before cancellation releases physical inventory.

The application service derives settlement under the same rental booking lock. The database migration adds an independent cancellation guard for the currently supported rental payment contract: unresolved rows, unsupported successful provider/kind combinations, or non-zero net manual settlement block `CONFIRMED -> CANCELLED`.

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
- `scripts/rental-payment-foundation-source-contract.test.mjs` protects tenant ownership, schema/migration constraints, booking-lock serialization, provider-adapter use, staff-route authority, cancellation settlement guards, and the no-deposit/no-online-checkout boundary.
- `src/server/payments/rental-payment.integration.ts` is registered in the guarded disposable-PostgreSQL runner and covers real payment/refund persistence, cross-tenant denial, cancellation blocking before refund, append-only evidence, and cancellation after full refund.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used for this validation.
