import { RentalDamageCasePanel } from '@/components/rental-damage-case-panel.tsx';
import { RentalLateReturnAssessmentPanel } from '@/components/rental-late-return-assessment-panel.tsx';
import { readRentalReturnInspection } from '@/server/bookings/rental-return-inspection-service.ts';

const outcomeLabels = {
  CLEAR: 'Clear',
  DAMAGE_REPORTED: 'Damage reported',
  UNSAFE: 'Unsafe',
} as const;

export async function RentalReturnInspectionPanel({
  organizationId,
  actorUserId,
  bookingId,
  fulfillmentState,
  canManage,
}: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  fulfillmentState: 'AWAITING_PICKUP' | 'PICKED_UP' | 'RETURNED';
  canManage: boolean;
}>) {
  if (fulfillmentState !== 'RETURNED') return null;

  const inspection = await readRentalReturnInspection({
    organizationId,
    actorUserId,
    bookingId,
  });
  const lateReturnAssessment = <RentalLateReturnAssessmentPanel
    organizationId={organizationId}
    actorUserId={actorUserId}
    bookingId={bookingId}
  />;

  if (inspection) {
    return <>
      <section className="sf-inventory-card" aria-labelledby="rental-return-inspection-title">
        <div className="sf-inventory-card__heading">
          <div>
            <p className="sf-eyebrow">Condition evidence</p>
            <h2 id="rental-return-inspection-title">Return inspection</h2>
          </div>
          <span>{outcomeLabels[inspection.outcome]}</span>
        </div>
        <ul className="sf-inventory-list">
          <li>
            <div className="sf-inventory-list__primary">
              <div>
                <strong>{outcomeLabels[inspection.outcome]}</strong>
                <span>
                  Inspected <time dateTime={inspection.inspectedAt.toISOString()}>{inspection.inspectedAt.toISOString()}</time>
                </span>
                {inspection.notes ? <span>{inspection.notes}</span> : null}
              </div>
            </div>
          </li>
        </ul>
        <p className="sf-field-hint">
          This is append-only return-condition evidence. Damage and unsafe outcomes quarantine an available unit out of service; they do not charge the customer, establish customer liability, or create a security-bond decision.
        </p>
      </section>
      <RentalDamageCasePanel
        organizationId={organizationId}
        actorUserId={actorUserId}
        bookingId={bookingId}
        inspectionOutcome={inspection.outcome}
        canManage={canManage}
      />
      {lateReturnAssessment}
    </>;
  }

  if (!canManage) {
    return <>
      <section className="sf-inventory-card" aria-labelledby="rental-return-inspection-title">
        <div className="sf-inventory-card__heading">
          <div>
            <p className="sf-eyebrow">Condition evidence</p>
            <h2 id="rental-return-inspection-title">Return inspection</h2>
          </div>
        </div>
        <p className="sf-field-hint">
          Return has been recorded, but no return inspection evidence exists. Your role cannot record inventory condition.
        </p>
      </section>
      {lateReturnAssessment}
    </>;
  }

  return <>
    <section className="sf-inventory-card" aria-labelledby="rental-return-inspection-title">
      <div className="sf-inventory-card__heading">
        <div>
          <p className="sf-eyebrow">Condition evidence</p>
          <h2 id="rental-return-inspection-title">Record return inspection</h2>
        </div>
      </div>
      <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/return-inspection`}>
        <label className="sf-field">
          Outcome
          <select name="outcome" defaultValue="CLEAR" required>
            <option value="CLEAR">Clear</option>
            <option value="DAMAGE_REPORTED">Damage reported</option>
            <option value="UNSAFE">Unsafe</option>
          </select>
        </label>
        <label className="sf-field">
          Inspection notes
          <textarea
            name="notes"
            maxLength={2000}
            rows={4}
            aria-describedby="rental-return-inspection-notes-hint"
          />
        </label>
        <p id="rental-return-inspection-notes-hint" className="sf-field-hint">
          Notes are required when damage or an unsafe condition is reported. A non-clear outcome takes an available unit out of service before the evidence is saved. It does not create a customer charge or security-bond decision.
        </p>
        <button className="sf-button sf-button--primary" type="submit">Record return inspection</button>
      </form>
    </section>
    {lateReturnAssessment}
  </>;
}
