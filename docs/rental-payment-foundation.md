# Rental payment foundation

SF supports a deliberately narrow production settlement boundary for confirmed rental bookings. Authorized staff can record one real full-value manual/offline booking-price payment and can later record one or more real manual/offline refunds against that retained settlement source. Refunds may be partial or may refund the full remaining source balance.

This is not a deposit workflow, split-tender payment workflow, or online checkout workflow. No provider action is presented as successful unless the corresponding real manual/offline event already happened outside SF.

## Persisted evidence

`RentalPaymentTransaction` is tenant-owned append-only settlement evidence linked to `RentalBooking` by the composite `(bookingId, organizationId)` foreign key. It stores tenant and booking identity, server-derived idempotency, request fingerprint, payment/refund kind and status, provider identity, explicit refund source attribution, exact currency and minor-unit amount, and database-authored creation time.

Database checks reject non-positive money, invalid currency/provider identity, malformed request evidence, unsupported provider/kind combinations, refunds without a retained source, over-refunds, and duplicate tenant provider references. Tenant-scoped uniqueness protects idempotency replay and real-world provider-reference identity.

## Bounded settlement reconciliation

Every financial decision reads the complete tenant-owned payment/refund chain through bounded 100-row cursor pages. The current safety limit is 1,000 transactions. Exceeding that limit fails closed rather than making a payment, refund, or cancellation decision from truncated history.

Rental-specific settlement remains intentionally stricter than the generic provider-neutral settlement model:

- successful booking-price funding must be one manual `OFFLINE_PAYMENT` equal to the full accepted rental total;
- successful refunds must use provider `manual`, kind `REFUND`, booking currency, and explicit retained source attribution;
- cumulative refunds cannot exceed the source payment;
- unresolved rows or successful evidence outside this enabled contract make the settlement unreconciled.

The derived states are `UNPAID`, `PAID`, `PARTIALLY_REFUNDED`, and `REFUNDED`. A partial refund is not treated as a new payment state or price change; it is retained refund evidence against already-settled booking money.

The staff read model computes reconciliation and the visible paginated history inside one `RepeatableRead` transaction so the count, settlement evidence, and returned page share one database snapshot.

## Manual full payment

`recordRentalManualOfflinePayment` requires `payment:manage`, validates tenant and actor identifiers, normalizes the real-world reference through `ManualPaymentProvider`, derives idempotency server-side, and serializes on the rental booking mutation lock.

A new payment is accepted only for a confirmed, positive-value, currently `UNPAID` rental. The service verifies the authoritative currency and full accepted amount, rejects duplicate manual references inside the tenant, requires the provider adapter result to match the exact request, appends successful evidence, and records a secret-free audit event.

The browser does not choose the payment amount, tenant, actor, provider, source, or idempotency key.

## Manual partial and full refunds

`recordRentalManualOfflineRefund` also requires `payment:manage` and the same booking serialization boundary. New refunds are available only while the confirmed rental is `PAID` or `PARTIALLY_REFUNDED`.

The staff form may submit a requested refund amount in booking currency. The server parses it with the shared currency-aware money parser, requires a positive amount, derives the current bounded settlement, selects the retained refundable source, and rejects an amount larger than the source's remaining refundable balance. If no amount is supplied by an internal caller, the service preserves the existing behavior of refunding the full remaining source balance.

The browser never chooses the tenant, actor, provider, settlement source, currency, minor-unit conversion, request fingerprint, or idempotency key. The source is always derived from retained settlement evidence.

Before provider-adapter I/O, the service binds the exact selected source and exact refund amount into the request fingerprint. The returned manual-provider result must rebuild to the same provider, refund reference, source reference, currency, and amount before persistence.

Partial refunds remain financially settled. Cancellation remains blocked until the booking-price settlement reaches net zero.

## Idempotent refund replay

Refund idempotency is operation/reference scoped. Replaying a retained refund re-resolves the tenant booking, rechecks the exact retained row and request fingerprint, rereads complete bounded settlement history, and verifies that the retained source still exists in reconciled history.

Replay does not require the whole booking to already be fully refunded. This is important for a legitimate partial refund: retrying the first partial refund must remain idempotent while the booking is still `PARTIALLY_REFUNDED`, after later refunds move it to `REFUNDED`, and after a later terminal cancellation. If the caller supplies an amount on replay, it must exactly match the retained refund amount.

## Cancellation financial guard

Rental cancellation is an inventory lifecycle mutation but fails closed while booking-price settlement is non-zero, unresolved, or unreconciled. Staff must record real refund evidence until net settled money is zero before cancellation can release physical inventory.

The application derives settlement under the booking lock. PostgreSQL independently blocks cancellation when unresolved evidence exists, unsupported successful provider/kind evidence exists, or net manual settlement is non-zero.

## Staff interaction and request handling

The authenticated rental booking detail renders settlement state and tenant-scoped transaction history to actors with `payment:read`.

Actors with `payment:manage` can record the full manual/offline booking-price payment and, once paid, enter a positive partial or full refund amount plus the real external refund reference. The form defaults to the current full refundable balance but staff may reduce it for a real partial refund.

Both payment mutation routes use the shared safe inventory form parser. Malformed form bodies are rejected as validation failures rather than escaping as generic server errors. Tenant and actor always come from authenticated server context.

## Deliberate boundaries

This foundation does not implement deposits, card authorization, Stripe rental checkout, customer self-service, split-tender or partial booking-price payments, multiple funding sources, chargebacks, cancellation fees, automatic refund policy, damage/security-bond settlement, pickup/return settlement, invoices, or external accounting synchronization.

Security bonds, damage liability, and late-return settlement remain separate append-only evidence streams with their own authority rules. No placeholder route or fake provider action is exposed for unsupported workflows.

## Validation

- `src/server/payments/rental-payment-domain.test.ts` covers unpaid/paid/partial-refund/refunded settlement states, fail-closed reconciliation, the full-value manual funding contract, and deterministic request evidence.
- `src/server/payments/payment-refund-execution-domain.test.ts` covers requested partial refund allocation and source-boundary enforcement in the shared refund planner.
- `src/server/payments/rental-payment-history.test.ts` covers bounded cursor pagination, deterministic evidence verification, and refund/source chronology.
- `scripts/rental-payment-foundation-source-contract.test.mjs` protects tenant ownership, safe route parsing, server-derived authority, requested partial refund wiring, exact replay evidence, bounded history, provider-adapter use, cancellation guards, and staff UI boundaries.
- `scripts/rental-payment-request-evidence-source-contract.test.mjs` protects pre-provider request binding and idempotent replay semantics for partial refunds.
- `src/server/payments/rental-payment.integration.ts` is registered in the guarded disposable-PostgreSQL runner and covers real payment/refund persistence, cross-tenant denial, partial refund and replay, cancellation blocking before zero settlement, append-only evidence, full refund, and cancellation after full refund.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used for this validation.
