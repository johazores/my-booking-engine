import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readRentalLateReturnSettlement } from '@/server/payments/rental-late-return-settlement-service.ts';

const settlementLabels = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
} as const;

export async function RentalLateReturnSettlementPanel({
  organizationId,
  actorUserId,
  bookingId,
  assessmentId,
  currency,
  feeMinor,
  canManage,
}: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  assessmentId: string;
  currency: string;
  feeMinor: bigint;
  canManage: boolean;
}>) {
  const result = await readRentalLateReturnSettlement({ organizationId, actorUserId, bookingId, assessmentId });
  const amount = `${currency} ${moneyMinorToMajorString(feeMinor, currency)}`;

  return <section className="sf-inventory-card" aria-labelledby="rental-late-return-settlement-title">
    <div className="sf-inventory-card__heading">
      <div>
        <p className="sf-eyebrow">Late-return settlement</p>
        <h2 id="rental-late-return-settlement-title">Late-return fee payment</h2>
      </div>
      <span>{settlementLabels[result.settlement.state]}</span>
    </div>

    <ul className="sf-inventory-list">
      <li><div className="sf-inventory-list__primary"><div>
        <strong>Fee authority {amount}</strong>
        <span>Settlement is separate from the immutable rental booking price and from damage/security-bond settlement.</span>
      </div></div></li>
      {result.transactions.map((transaction) => <li key={transaction.id}><div className="sf-inventory-list__primary"><div>
        <strong>{transaction.kind === 'OFFLINE_PAYMENT' ? 'Offline payment' : 'Offline refund'} {transaction.currency} {moneyMinorToMajorString(transaction.amountMinor, transaction.currency)}</strong>
        <span>Manual reference {transaction.providerReference}</span>
        {transaction.sourceProviderReference ? <span>Source payment {transaction.sourceProviderReference}</span> : null}
        <span>Recorded <time dateTime={transaction.createdAt.toISOString()}>{transaction.createdAt.toISOString()}</time></span>
      </div></div></li>)}
    </ul>

    {canManage && result.settlement.state === 'UNPAID' ? <form
      className="sf-form"
      method="post"
      action={`/api/inventory/rentals/bookings/${bookingId}/late-return-assessment/${assessmentId}/settlement/manual`}
    >
      <label className="sf-field">
        Offline payment reference
        <input name="reference" maxLength={120} required />
      </label>
      <p className="sf-field-hint">
        Record this only after the full {amount} was actually received outside SF. This records settlement evidence only; SF does not move money or charge a card.
      </p>
      <button className="sf-button sf-button--primary" type="submit">Record late-return payment</button>
    </form> : null}

    {canManage && result.settlement.state === 'PAID' ? <form
      className="sf-form"
      method="post"
      action={`/api/inventory/rentals/bookings/${bookingId}/late-return-assessment/${assessmentId}/settlement/refund`}
    >
      <label className="sf-field">
        Offline refund reference
        <input name="reference" maxLength={120} required />
      </label>
      <p className="sf-field-hint">
        Record this only after the full {amount} was actually refunded outside SF. Partial late-return refunds are not enabled by this contract.
      </p>
      <button className="sf-button sf-button--secondary" type="submit">Record late-return refund</button>
    </form> : null}

    {!canManage ? <p className="sf-field-hint">Your role can read retained late-return settlement evidence but cannot record payment or refund evidence.</p> : null}
    <p className="sf-field-hint">
      The current settlement contract is full-value manual/offline evidence only. Partial, split-tender, card, and provider-backed late-return settlement remain separate production workflows.
    </p>
  </section>;
}
