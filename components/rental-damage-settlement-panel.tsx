import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readRentalDamageSettlement } from '@/server/payments/rental-damage-settlement-service.ts';

const settlementLabels = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
} as const;

export async function RentalDamageSettlementPanel({
  organizationId,
  actorUserId,
  bookingId,
  damageCaseId,
  currency,
  liableAmountMinor,
  canManage,
}: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  currency: string;
  liableAmountMinor: bigint;
  canManage: boolean;
}>) {
  const result = await readRentalDamageSettlement({ organizationId, actorUserId, bookingId, damageCaseId });
  const amount = `${currency} ${moneyMinorToMajorString(liableAmountMinor, currency)}`;

  return <section className="sf-inventory-card" aria-labelledby="rental-damage-settlement-title">
    <div className="sf-inventory-card__heading">
      <div>
        <p className="sf-eyebrow">Damage settlement</p>
        <h2 id="rental-damage-settlement-title">Customer damage payment</h2>
      </div>
      <span>{settlementLabels[result.settlement.state]}</span>
    </div>

    <ul className="sf-inventory-list">
      <li><div className="sf-inventory-list__primary"><div>
        <strong>Liability authority {amount}</strong>
        <span>Settlement is separate from the immutable rental booking price and its payment history.</span>
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
      action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCaseId}/settlement/manual`}
    >
      <label className="sf-field">
        Offline payment reference
        <input name="reference" maxLength={120} required />
      </label>
      <p className="sf-field-hint">
        Record this only after the full {amount} was actually received outside SF. This action records evidence; it does not move money or charge a card.
      </p>
      <button className="sf-button sf-button--primary" type="submit">Record damage payment</button>
    </form> : null}

    {canManage && result.settlement.state === 'PAID' ? <form
      className="sf-form"
      method="post"
      action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCaseId}/settlement/refund`}
    >
      <label className="sf-field">
        Offline refund reference
        <input name="reference" maxLength={120} required />
      </label>
      <p className="sf-field-hint">
        Record this only after the full {amount} was actually refunded outside SF. Partial damage refunds are not enabled by this contract.
      </p>
      <button className="sf-button sf-button--secondary" type="submit">Record damage refund</button>
    </form> : null}

    {!canManage ? <p className="sf-field-hint">Your role can read retained damage settlement evidence but cannot record payment or refund evidence.</p> : null}
    <p className="sf-field-hint">
      Security-bond authorization, capture, release, forfeiture, online checkout, split tenders, and partial damage settlement remain separate workflows and are not represented here.
    </p>
  </section>;
}
