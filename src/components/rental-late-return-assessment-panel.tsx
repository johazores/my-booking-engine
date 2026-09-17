import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readRentalLateReturnAssessment } from '@/server/bookings/rental-late-return-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';

export async function RentalLateReturnAssessmentPanel({
  organizationId,
  actorUserId,
  bookingId,
}: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  const authorization = await readOrganizationAuthorization({ organizationId, userId: actorUserId });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  if (!hasPermission('booking:read') || !hasPermission('payment:read')) return null;
  const canManage = hasPermission('booking:manage') && hasPermission('payment:manage');
  const data = await readRentalLateReturnAssessment({ organizationId, actorUserId, bookingId });

  if (!data.returnEvent || data.lateDays === 0) return null;

  if (data.assessment) {
    const fee = data.assessment.feeMinor === null
      ? null
      : `${data.assessment.currency} ${moneyMinorToMajorString(data.assessment.feeMinor, data.assessment.currency)}`;
    return <section className="sf-inventory-card" aria-labelledby="rental-late-return-assessment-title">
      <div className="sf-inventory-card__heading">
        <div><p className="sf-eyebrow">Commercial return evidence</p><h2 id="rental-late-return-assessment-title">Late-return assessment</h2></div>
        <span>{data.assessment.outcome === 'FEE_ASSESSED' ? 'Fee assessed' : 'Waived'}</span>
      </div>
      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div>
          <strong>{data.assessment.lateDays} late day{data.assessment.lateDays === 1 ? '' : 's'} · {data.assessment.graceDays} grace day{data.assessment.graceDays === 1 ? '' : 's'}</strong>
          <span>{data.assessment.chargeableDays} chargeable day{data.assessment.chargeableDays === 1 ? '' : 's'} · committed end {data.assessment.committedEndsOn.toISOString().slice(0, 10)}</span>
          <span>{fee ? `Retained fee authority ${fee}` : 'Fee waived'}</span>
          <span>{data.assessment.reason}</span>
          <span>Assessed <time dateTime={data.assessment.assessedAt.toISOString()}>{data.assessment.assessedAt.toISOString()}</time> · append-only evidence</span>
        </div></div></li>
      </ul>
      <p className="sf-field-hint">This assessment records commercial authority only. It does not change the committed rental period, extend custody, collect money, authorize a card, create a provider transaction, or settle the fee.</p>
    </section>;
  }

  return <section className="sf-inventory-card" aria-labelledby="rental-late-return-assessment-title">
    <div className="sf-inventory-card__heading">
      <div><p className="sf-eyebrow">Commercial return evidence</p><h2 id="rental-late-return-assessment-title">Late-return assessment</h2></div>
      <span>{data.lateDays} late day{data.lateDays === 1 ? '' : 's'}</span>
    </div>
    {canManage ? <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/late-return-assessment`} aria-describedby="rental-late-return-assessment-hint">
      <label className="sf-field">Outcome<select name="outcome" defaultValue="FEE_ASSESSED" required><option value="FEE_ASSESSED">Assess fee</option><option value="WAIVED">Waive fee</option></select></label>
      <label className="sf-field">Grace days<input name="graceDays" type="number" min="0" max="30" step="1" defaultValue="0" required /></label>
      <label className="sf-field">Fee amount ({data.booking.currency})<input name="feeAmountMajor" inputMode="decimal" /></label>
      <label className="sf-field">Assessment reason<textarea name="reason" maxLength={2000} rows={4} required /></label>
      <p id="rental-late-return-assessment-hint" className="sf-field-hint">The retained return occurred {data.lateDays} calendar day{data.lateDays === 1 ? '' : 's'} late in the booking location timezone. Grace days are an explicit case decision, not an automatic tenant policy. A fee requires at least one day beyond grace and a positive exact amount; leave the amount blank when waiving. This decision is irreversible and does not move money.</p>
      <label className="sf-field"><span><input name="confirmation" type="checkbox" value="ACKNOWLEDGED" required /> I confirm this append-only assessment matches the approved commercial decision.</span></label>
      <button className="sf-button sf-button--primary" type="submit">Record late-return assessment</button>
    </form> : <p className="sf-field-hint">Return evidence is late, but no commercial assessment has been retained. Your role can view the evidence but cannot assess or waive a fee.</p>}
  </section>;
}
