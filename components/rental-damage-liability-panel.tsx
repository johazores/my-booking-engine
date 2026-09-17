import { moneyMinorToMajorString } from '@/server/pricing/money.ts';

type DamageLiabilityDecisionEvidence = Readonly<{
  outcome: 'CUSTOMER_LIABLE' | 'NO_CUSTOMER_LIABILITY';
  currency: string;
  liableAmountMinor: bigint | null;
  reason: string;
  decidedAt: Date;
}>;

export function RentalDamageLiabilityPanel({
  bookingId,
  damageCaseId,
  currency,
  estimatedRepairCostMinor,
  decision,
  canManage,
}: Readonly<{
  bookingId: string;
  damageCaseId: string;
  currency: string;
  estimatedRepairCostMinor: bigint;
  decision: DamageLiabilityDecisionEvidence | null;
  canManage: boolean;
}>) {
  const estimate = `${currency} ${moneyMinorToMajorString(estimatedRepairCostMinor, currency)}`;

  if (decision) {
    const liableAmount = decision.liableAmountMinor === null
      ? null
      : `${decision.currency} ${moneyMinorToMajorString(decision.liableAmountMinor, decision.currency)}`;
    return <section className="sf-inventory-card" aria-labelledby="rental-damage-liability-title">
      <div className="sf-inventory-card__heading">
        <div>
          <p className="sf-eyebrow">Commercial decision</p>
          <h2 id="rental-damage-liability-title">Customer damage liability</h2>
        </div>
        <span>{decision.outcome === 'CUSTOMER_LIABLE' ? 'Customer liable' : 'No customer liability'}</span>
      </div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div>
          <strong>{liableAmount ? `Liability ${liableAmount}` : 'No customer amount due from this damage case'}</strong>
          <span>{decision.reason}</span>
          <span>Repair estimate authority {estimate}</span>
          <span>Decided <time dateTime={decision.decidedAt.toISOString()}>{decision.decidedAt.toISOString()}</time></span>
        </div></div></li>
      </ul>
      <p className="sf-field-hint">
        This append-only decision records commercial liability evidence only. It does not charge the customer, authorize a card, collect a security bond, or mark any amount as paid.
      </p>
    </section>;
  }

  return <section className="sf-inventory-card" aria-labelledby="rental-damage-liability-title">
    <div className="sf-inventory-card__heading">
      <div>
        <p className="sf-eyebrow">Commercial decision</p>
        <h2 id="rental-damage-liability-title">Customer damage liability</h2>
      </div>
      <span>Repair estimate {estimate}</span>
    </div>
    {canManage ? <form
      className="sf-form"
      method="post"
      action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCaseId}/liability`}
      aria-describedby="rental-damage-liability-hint"
    >
      <label className="sf-field">
        Decision
        <select name="outcome" defaultValue="CUSTOMER_LIABLE" required>
          <option value="CUSTOMER_LIABLE">Customer liable</option>
          <option value="NO_CUSTOMER_LIABILITY">No customer liability</option>
        </select>
      </label>
      <label className="sf-field">
        Customer liability amount ({currency})
        <input name="liableAmountMajor" inputMode="decimal" />
      </label>
      <label className="sf-field">
        Decision reason
        <textarea name="reason" maxLength={2000} rows={4} required />
      </label>
      <p id="rental-damage-liability-hint" className="sf-field-hint">
        Enter an amount only for customer liability. It must be positive and cannot exceed the retained repair estimate of {estimate}. Leave the amount blank for no customer liability. This decision is irreversible and does not collect money.
      </p>
      <button className="sf-button sf-button--primary" type="submit">Record liability decision</button>
    </form> : <p className="sf-field-hint">
      No customer liability decision has been retained. Your role can read this commercial evidence but cannot record it.
    </p>}
    <p className="sf-field-hint">
      Liability is recorded only after the operational damage case is closed so the decision is based on retained assessed and resolution evidence.
    </p>
  </section>;
}
