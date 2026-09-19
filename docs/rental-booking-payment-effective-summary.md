# Rental booking effective settlement on staff detail

The authenticated rental booking detail must distinguish immutable original booking-price evidence from current effective financial authority after a commercial amendment.

Before a commercial amendment is applied, the payment panel continues to show the reconciled original booking-price settlement and may expose supported manual/offline payment or refund actions when `readRentalOriginalPaymentLedgerAuthority` says that ledger is writable.

After one commercial amendment reaches `APPLIED`, the original `RentalPaymentTransaction` ledger is historical source evidence. The payment panel therefore reads `readRentalBookingEffectiveSettlement` for the active tenant and authenticated actor and presents the combined effective settlement instead of using the original ledger payment state as the current commercial summary.

The applied-amendment summary shows the effective accepted total, current effective net, refund amount still required before exact-zero cancellation, the retained amendment direction/delta, and the original booking-time total/net as historical evidence. The badge is derived from effective settlement: paid, partially refunded, refunded, or reconciliation required.

If protected effective settlement cannot be reconciled or cannot be matched to the amendment that froze the original ledger, the staff surface fails closed with `RECONCILIATION REQUIRED`. It does not fall back to presenting the original booking-price state as current financial authority.

Original booking-price transaction rows remain visible because they are part of the immutable audit trail. They are explicitly labelled historical after apply, while commercial adjustment and post-apply refund evidence remains available from the retained commercial-amendment/effective-settlement workspace.

The booking detail commercial-evidence card also labels `RentalBooking.totalMinor` as the **original booking-time amount** rather than a generic current accepted amount. That card remains useful to actors with booking access, but after an applied amendment it points authorized payment readers to the protected effective-settlement section for current financial authority.

The original payment and refund forms continue to depend on the protected original-ledger write authority. `PREPARED` and `APPLIED` amendments expose no original-ledger write action, so this summary change does not create a new financial writer or bypass the existing commercial ownership handoff.

Server authorization remains authoritative. `readRentalBookingEffectiveSettlement` requires `booking:read` and `payment:read`, repeats tenant scope on retained booking/amendment/payment evidence, and performs its combined read under `RepeatableRead`. UI state never grants settlement or refund authority.

## Deliberate boundary

This staff summary does not implement provider-backed collection/refunds, automatic cancellation fees, automatic refund policy, customer self-service, invoices, or external accounting synchronization. It only ensures that an already-supported applied amendment is represented by its real effective settlement on the primary rental booking detail.

## Validation

`scripts/rental-booking-payment-effective-summary-source-contract.test.mjs` protects the effective-settlement read, applied-amendment matching, fail-closed reconciliation state, historical original-ledger labelling, and continued no-dead-action write gating.

Repository-wide validation remains `npm run validate` under the Node version declared in `package.json`. Database execution remains `npm run test:database` against an explicitly disposable PostgreSQL target. GitHub Actions are not required or used.
