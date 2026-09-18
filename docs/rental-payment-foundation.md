# Rental payment foundation

SF supports a deliberately narrow production settlement boundary for confirmed rental bookings. Authorized staff can record multiple real manual/offline booking-price payments until the accepted booking total is fully settled, and can later record one or more real manual/offline refunds against retained payment sources. Both payments and refunds may be partial.

This is not a deposit-policy workflow, mixed-provider settlement workflow, or online checkout workflow. No provider action is presented as successful unless the corresponding real manual/offline event already happened outside SF.

## Persisted evidence

`RentalPaymentTransaction` is tenant-owned append-only settlement evidence linked to `RentalBooking` by the composite `(bookingId, organizationId)` foreign key. It stores tenant and booking identity, server-derived idempotency, request fingerprint, payment/refund kind and status, provider identity, explicit refund source attribution, exact currency and minor-unit amount, and database-authored creation time.

Database checks reject non-positive money, invalid currency/provider identity, malformed request evidence, unsupported provider/kind combinations, refunds without a retained source, source over-refunds, booking overpayment, and duplicate tenant provider references. Tenant-scoped uniqueness protects idempotency replay and real-world provider-reference identity. Cross-ledger guards keep one real manual reference from representing multiple rental commercial events in the same tenant.

## Bounded settlement reconciliation

Every financial decision reads the complete tenant-owned payment/refund chain through bounded 100-row cursor pages. The current safety limit is 1,000 transactions. Exceeding that limit fails closed rather than making a payment, refund, or cancellation decision from truncated history.

Rental-specific settlement remains intentionally stricter than the generic provider-neutral settlement model:

- successful booking-price funding must use provider `manual`, kind `OFFLINE_PAYMENT`, booking currency, positive exact money, and a unique retained external reference;
- cumulative net settlement may never exceed the authoritative accepted rental total;
- successful refunds must use provider `manual`, kind `REFUND`, booking currency, and explicit retained source attribution;
- cumulative refunds cannot exceed the selected source payment;
- unresolved rows or successful evidence outside this enabled contract make the settlement unreconciled.

The derived states are `UNPAID`, `PARTIALLY_PAID`, `PAID`, `PARTIALLY_REFUNDED`, and `REFUNDED`. `PARTIALLY_PAID` means real retained booking-price funding exists but net settlement is still below the accepted total and no refund has occurred. `PARTIALLY_REFUNDED` means retained refunds have reduced positive net settlement below the accepted total.

Gross funding may exceed the accepted total over the lifetime of the append-only ledger only when prior retained refunds make replacement funding safe. Current net settlement is always bounded to the authoritative accepted total.

The staff read model computes reconciliation and the visible paginated history inside one `RepeatableRead` transaction so the count, settlement evidence, and returned page share one database snapshot.

## Manual partial or full payments

`recordRentalManualOfflinePayment` requires `payment:manage`, validates tenant and actor identifiers, normalizes the real-world reference through `ManualPaymentProvider`, derives idempotency server-side, and serializes on the rental booking mutation lock.

The staff form supplies a requested amount in booking currency and a real external reference. The server parses the amount with the shared currency-aware money parser, requires a positive value, derives current bounded settlement, computes the authoritative outstanding balance, and rejects any payment larger than that balance. Internal callers that omit the amount retain the prior full-outstanding behavior.

Before provider-adapter I/O, the exact amount, tenant, booking, operation, provider identity, external reference, currency, and idempotency key are bound into the request fingerprint. The adapter result must rebuild to the same exact request before persistence.

A new payment is accepted only for a confirmed positive-value rental with a positive outstanding booking balance. Each successful payment becomes a separate retained settlement source. Recording additional manual payments does not rewrite the accepted booking total or prior payment evidence.

The browser never chooses the tenant, actor, provider, currency, minor-unit conversion, request fingerprint, or idempotency key. Its amount is only a requested value and is bounded again by current server-derived settlement authority under the booking lock.

## Manual partial and full refunds

`recordRentalManualOfflineRefund` also requires `payment:manage` and the same booking serialization boundary. A refund can be recorded whenever the confirmed rental has positive reconciled original booking-price net settlement, including a `PARTIALLY_PAID` rental, provided no applied commercial amendment has moved authority to the effective-settlement ledger.

The staff form submits a requested refund amount in booking currency. The server parses it with the shared currency-aware money parser, requires a positive amount, derives current bounded settlement, selects the next retained refundable source deterministically, and rejects an amount larger than that source's remaining refundable balance. If no amount is supplied by an internal caller, the service refunds the selected source's full remaining balance.

With multiple retained payment sources, a single refund transaction is always source-bound. The staff form defaults to the currently selected source's refundable balance rather than the whole booking balance so the primary action cannot submit an amount that the source allocator must reject. Additional real refunds can be recorded against later sources as needed.

The browser never chooses the tenant, actor, provider, settlement source, currency, minor-unit conversion, request fingerprint, or idempotency key. The source is always derived from retained settlement evidence.

Before provider-adapter I/O, the exact selected source and exact refund amount are bound into the request fingerprint. The returned manual-provider result must rebuild to the same provider, refund reference, source reference, currency, and amount before persistence.

Partial refunds remain financially settled. For a rental without an applied commercial amendment, cancellation remains blocked until this booking-price net settlement reaches zero. After an applied commercial amendment, direct writes to this original ledger are blocked and later refunds use the adjustment-aware effective settlement contract instead.

## Idempotent replay

Payment and refund idempotency are operation/reference scoped. Replaying retained evidence re-resolves the tenant booking, rechecks the exact retained row and request fingerprint, and rereads complete bounded settlement history.

If a caller supplies an amount on replay, it must exactly match the retained transaction amount. A legitimate payment replay remains valid after later payments, refunds, full settlement, or terminal cancellation because replay verifies immutable evidence rather than pretending the old payment is a new write. Refund replay likewise remains valid across later settlement transitions when its retained source still reconciles.

## Database payment authority

The original rental payment migration created the append-only ledger and cancellation guard. The later partial-manual-payment migration replaces the insert-authority function in place while preserving the existing trigger.

For a new manual payment PostgreSQL reacquires the tenant/booking advisory lock, resolves the confirmed tenant booking, verifies booking currency/provider/status authority, derives existing successful manual net settlement, and rejects the row when `current net + new amount` would exceed the authoritative booking total. This independently protects against concurrent browser/service races and direct writes.

Refunds still require a matching retained successful manual source and cannot cumulatively exceed that source amount. Provider references remain tenant-unique and cross-ledger isolated.

After one commercial amendment is applied, the existing database post-apply guard freezes this original booking-price ledger. Further commercial refunds are written only as dedicated `RentalBookingEffectiveRefundTransaction` evidence so the immutable original ledger cannot be silently repurposed.

## Cancellation financial guard

Rental cancellation is an inventory lifecycle mutation but fails closed while the **effective settlement** is non-zero, incomplete, or unreconciled. The application derives the combined settlement under the booking lock and requires exact zero `currentNetSettledMinor` plus `fullyRefunded` before cancellation can release physical inventory.

Without an applied commercial amendment, effective settlement is the ordinary bounded booking-price ledger described above and the database still requires original net settlement to be zero.

With the one supported applied price-changing amendment, PostgreSQL independently requires the original ledger to remain equal to the amendment before-total, exact uncompensated adjustment evidence, and post-apply effective refunds totaling the amendment after-total. Per-source effective-refund guards continue to prevent over-refunds. This replaces the former blanket applied-amendment cancellation block with an exact zero-net condition.

Cancellation itself never creates or assumes refund evidence. See [rental-booking-effective-settlement.md](./rental-booking-effective-settlement.md) and [rental-booking-cancellation.md](./rental-booking-cancellation.md).

## Staff interaction and request handling

The authenticated rental booking detail renders original booking-price settlement state, net settled amount, outstanding balance, gross retained funding, refunded amount, and tenant-scoped transaction history to actors with `payment:read`.

Actors with `payment:manage` can enter a positive manual/offline payment amount up to the current outstanding balance plus the real external receipt/reference. While positive original booking-price money exists and no commercial amendment has moved settlement authority, they can enter a positive partial or full source-bound refund plus the real external refund reference.

The cancellation section independently resolves the protected effective settlement for actors with `payment:read`, so post-amendment cancellation readiness is never inferred from the original booking-price panel alone.

Both original payment mutation routes use the shared safe inventory form parser. Malformed or missing amount/form bodies are rejected as validation failures rather than escaping as generic server errors. Tenant and actor always come from authenticated server context.

## Deliberate boundaries

This foundation does not implement deposits or deposit policy, card authorization, Stripe rental checkout, customer self-service, mixed-provider settlement, card/manual tender mixing, chargebacks, cancellation fees, automatic refund policy, invoices, or external accounting synchronization.

Security bonds, damage liability, late-return settlement, commercial-amendment adjustment settlement, and post-apply effective refunds remain separate append-only evidence streams with their own authority rules. Multiple manual booking-price receipts are supported, but this must not be represented as a generic payment-plan engine, automatic installment scheduler, online split-tender checkout, or provider-backed partial capture workflow.

No placeholder route or fake provider action is exposed for unsupported workflows.

## Validation

- `src/server/payments/rental-payment-domain.test.ts` covers unpaid/partial-paid/paid/partial-refund/refunded states, multiple manual sources, replacement funding after retained refunds, outstanding balance, next refundable source amount, and fail-closed reconciliation.
- `src/server/payments/payment-refund-execution-domain.test.ts` covers requested partial refund allocation and source-boundary enforcement in the shared refund planner.
- `src/server/payments/rental-payment-history.test.ts` covers bounded cursor pagination, deterministic evidence verification, and refund/source chronology.
- `scripts/rental-payment-foundation-source-contract.test.mjs` protects tenant ownership, explicit payment/refund amount parsing, server-derived authority, bounded outstanding funding, source-bound refunds, PostgreSQL balance authority, effective cancellation guards, live-database coverage registration, and staff UI wiring.
- `scripts/rental-payment-request-evidence-source-contract.test.mjs` protects pre-provider request binding and idempotent replay semantics.
- `src/server/payments/rental-payment.integration.ts` is registered in the guarded disposable-PostgreSQL runner and covers partial manual funding, replay, multi-source full settlement, direct overpayment rejection, refunds, cancellation blocking before zero original settlement, append-only evidence, and cancellation after full refund for the no-amendment path.
- Full repository validation remains `npm run validate` on the Node version declared by `package.json`.
- Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target.

GitHub Actions are not required or used for this validation.
