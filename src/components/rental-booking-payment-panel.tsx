import Link from 'next/link';

import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import type { RentalPaymentSettlement } from '@/server/payments/rental-payment-domain.ts';

type RentalPaymentTransactionView = Readonly<{
  id: string;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export function RentalBookingPaymentPanel({
  bookingId,
  bookingStatus,
  bookingCurrency,
  settlement,
  transactions,
  canManage,
}: Readonly<{
  bookingId: string;
  bookingStatus: string;
  bookingCurrency: string;
  settlement: RentalPaymentSettlement;
  transactions: readonly RentalPaymentTransactionView[];
  canManage: boolean;
}>) {
  const confirmed = bookingStatus === 'CONFIRMED';
  const canRecordPayment = confirmed && settlement.reconciled && settlement.paymentState === 'UNPAID' && canManage;
  const canRefund = confirmed
    && settlement.reconciled
    && (settlement.paymentState === 'PAID' || settlement.paymentState === 'PARTIALLY_REFUNDED')
    && canManage;

  return <section className="sf-inventory-card" aria-labelledby="rental-payment-title">
    <div className="sf-inventory-card__heading">
      <div><p className="sf-eyebrow">Payment settlement</p><h2 id="rental-payment-title">Rental payment history</h2></div>
      <span>{settlement.reconciled ? settlement.paymentState : 'RECONCILIATION REQUIRED'}</span>
    </div>

    {!settlement.reconciled ? <p className="sf-alert sf-alert--error" role="alert">{settlement.reason}</p> : <ul className="sf-inventory-list">
      <li><div className="sf-inventory-list__primary"><div><strong>Net settled</strong><span>{moneyMinorToMajorString(settlement.netSettledMinor, bookingCurrency)} · gross {moneyMinorToMajorString(settlement.grossSettledMinor, bookingCurrency)} · refunded {moneyMinorToMajorString(settlement.refundedMinor, bookingCurrency)}</span></div></div></li>
    </ul>}

    {transactions.length > 0 ? <ul className="sf-inventory-list">
      {transactions.map((transaction) => <li key={transaction.id}><div className="sf-inventory-list__primary"><div><strong>{transaction.kind.replaceAll('_', ' ').toLowerCase()} · {transaction.status.toLowerCase()}</strong><span>{transaction.currency} {moneyMinorToMajorString(transaction.amountMinor, transaction.currency)} · {transaction.providerCode} · <code>{transaction.providerReference}</code></span>{transaction.sourceProviderReference ? <span>Refund source <code>{transaction.sourceProviderReference}</code></span> : null}<span><time dateTime={transaction.createdAt.toISOString()}>{transaction.createdAt.toISOString()}</time></span></div></div></li>)}
    </ul> : <p className="sf-field-hint">No payment transaction has been recorded for this rental booking.</p>}

    {canRecordPayment ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/payments/manual`}>
      <label className="sf-field"><span>Offline payment reference</span><input name="reference" type="text" maxLength={120} required autoComplete="off" aria-describedby="rental-payment-reference-hint" /></label>
      <p id="rental-payment-reference-hint" className="sf-field-hint">Record only a real external receipt, bank, cash, or accounting reference. This action records the full accepted rental amount.</p>
      <button className="sf-button" type="submit">Record full payment</button>
    </form> : null}

    {canRefund ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/payments/refunds`}>
      <label className="sf-field"><span>Offline refund reference</span><input name="reference" type="text" maxLength={120} required autoComplete="off" aria-describedby="rental-refund-reference-hint" /></label>
      <p id="rental-refund-reference-hint" className="sf-field-hint">This records a real full remaining refund against the current manual settlement source. Refund settled money before cancelling the rental booking.</p>
      <button className="sf-button sf-button--secondary" type="submit">Record remaining refund</button>
    </form> : null}

    <p>
      <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/security-bond`}>Security bond</Link>
    </p>
    {!canManage ? <p className="sf-field-hint">Your organization role can view rental payment evidence but cannot record payments or refunds.</p> : null}
    <p className="sf-field-hint">Booking-price settlement supports staff-recorded manual/offline full payment and refund evidence only. A real manual/offline security bond requirement, collection, and release is managed separately. Online checkout, card authorization/capture, bond forfeiture, chargebacks, fees, and customer self-service are not enabled.</p>
  </section>;
}
