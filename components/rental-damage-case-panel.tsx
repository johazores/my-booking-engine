import { RentalDamageLiabilityPanel } from '@/components/rental-damage-liability-panel.tsx';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readRentalDamageCase } from '@/server/bookings/rental-damage-case-service.ts';
import { readRentalDamageLiabilityDecision } from '@/server/bookings/rental-damage-liability-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';

const statusLabels = {
  OPEN: 'Open',
  ASSESSED: 'Assessed',
  WAIVED: 'Waived',
  CLOSED: 'Closed',
} as const;

export async function RentalDamageCasePanel({
  organizationId,
  actorUserId,
  bookingId,
  inspectionOutcome,
  canManage,
}: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  inspectionOutcome: 'CLEAR' | 'DAMAGE_REPORTED' | 'UNSAFE';
  canManage: boolean;
}>) {
  if (inspectionOutcome === 'CLEAR') return null;

  const damageCase = await readRentalDamageCase({
    organizationId,
    actorUserId,
    bookingId,
  });

  if (!damageCase) {
    return <section className="sf-inventory-card" aria-labelledby="rental-damage-case-title">
      <div className="sf-inventory-card__heading">
        <div>
          <p className="sf-eyebrow">Damage follow-up</p>
          <h2 id="rental-damage-case-title">Damage case</h2>
        </div>
      </div>
      {canManage ? <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/damage-case`}>
        <label className="sf-field">
          Case summary
          <textarea
            name="summary"
            maxLength={1000}
            rows={4}
            required
            aria-describedby="rental-damage-case-summary-hint"
          />
        </label>
        <p id="rental-damage-case-summary-hint" className="sf-field-hint">
          Open a retained operational damage case from this non-clear return inspection. This does not charge the customer, establish customer liability, or create a security-bond decision.
        </p>
        <button className="sf-button sf-button--primary" type="submit">Open damage case</button>
      </form> : <p className="sf-field-hint">
        A non-clear return inspection exists, but no damage case has been opened. Your role cannot manage damage follow-up.
      </p>}
    </section>;
  }

  const estimatedRepairCost = damageCase.estimatedRepairCostMinor === null
    ? null
    : `${damageCase.currency} ${moneyMinorToMajorString(damageCase.estimatedRepairCostMinor, damageCase.currency)}`;
  const isActive = damageCase.status === 'OPEN' || damageCase.status === 'ASSESSED';
  const hasClosedAssessedAuthority = damageCase.estimatedRepairCostMinor !== null
    && damageCase.status === 'CLOSED';

  let liabilityDecision: Awaited<ReturnType<typeof readRentalDamageLiabilityDecision>> = null;
  let canReadLiability = false;
  let canManageLiability = false;
  if (hasClosedAssessedAuthority) {
    const authorization = await readOrganizationAuthorization({ organizationId, userId: actorUserId });
    const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
      authorization.platformAdmin
      || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
    );
    canReadLiability = hasPermission('booking:read') && hasPermission('payment:read');
    canManageLiability = hasPermission('booking:manage') && hasPermission('payment:manage');
    if (canReadLiability) {
      liabilityDecision = await readRentalDamageLiabilityDecision({
        organizationId,
        actorUserId,
        bookingId,
        damageCaseId: damageCase.id,
      });
    }
  }

  return <>
    <section className="sf-inventory-card" aria-labelledby="rental-damage-case-title">
      <div className="sf-inventory-card__heading">
        <div>
          <p className="sf-eyebrow">Damage follow-up</p>
          <h2 id="rental-damage-case-title">Damage case</h2>
        </div>
        <span>{statusLabels[damageCase.status]}</span>
      </div>

      <ul className="sf-inventory-list">
        <li><div className="sf-inventory-list__primary"><div>
          <strong>{damageCase.summary}</strong>
          <span>Opened <time dateTime={damageCase.openedAt.toISOString()}>{damageCase.openedAt.toISOString()}</time></span>
        </div></div></li>
        {estimatedRepairCost ? <li><div className="sf-inventory-list__primary"><div>
          <strong>Repair estimate {estimatedRepairCost}</strong>
          <span>{damageCase.assessmentNotes}</span>
          {damageCase.assessedAt ? <span>Assessed <time dateTime={damageCase.assessedAt.toISOString()}>{damageCase.assessedAt.toISOString()}</time></span> : null}
        </div></div></li> : null}
        {damageCase.waiverReason ? <li><div className="sf-inventory-list__primary"><div>
          <strong>Case waived</strong>
          <span>{damageCase.waiverReason}</span>
          {damageCase.waivedAt ? <span>Waived <time dateTime={damageCase.waivedAt.toISOString()}>{damageCase.waivedAt.toISOString()}</time></span> : null}
        </div></div></li> : null}
        {damageCase.resolutionNotes ? <li><div className="sf-inventory-list__primary"><div>
          <strong>Case resolved</strong>
          <span>{damageCase.resolutionNotes}</span>
          {damageCase.closedAt ? <span>Closed <time dateTime={damageCase.closedAt.toISOString()}>{damageCase.closedAt.toISOString()}</time></span> : null}
        </div></div></li> : null}
      </ul>

      {canManage && damageCase.status === 'OPEN' ? <div className="sf-inventory-layout">
        <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCase.id}`}>
          <input type="hidden" name="action" value="assess" />
          <label className="sf-field">
            Estimated repair cost ({damageCase.currency})
            <input name="estimatedRepairCostMajor" inputMode="decimal" required />
          </label>
          <label className="sf-field">
            Assessment notes
            <textarea name="notes" maxLength={2000} rows={4} required />
          </label>
          <button className="sf-button sf-button--primary" type="submit">Record assessment</button>
        </form>
        <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCase.id}`}>
          <input type="hidden" name="action" value="waive" />
          <label className="sf-field">
            Waiver reason
            <textarea name="reason" maxLength={1000} rows={4} required />
          </label>
          <button className="sf-button sf-button--secondary" type="submit">Waive damage case</button>
        </form>
      </div> : null}

      {canManage && damageCase.status === 'ASSESSED' ? <div className="sf-inventory-layout">
        <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCase.id}`}>
          <input type="hidden" name="action" value="close" />
          <label className="sf-field">
            Resolution notes
            <textarea name="notes" maxLength={2000} rows={4} required />
          </label>
          <button className="sf-button sf-button--primary" type="submit">Close damage case</button>
        </form>
        {!liabilityDecision ? <form className="sf-form" method="post" action={`/api/inventory/rentals/bookings/${bookingId}/damage-case/${damageCase.id}`}>
          <input type="hidden" name="action" value="waive" />
          <label className="sf-field">
            Waiver reason
            <textarea name="reason" maxLength={1000} rows={4} required />
          </label>
          <button className="sf-button sf-button--secondary" type="submit">Waive damage case</button>
        </form> : null}
      </div> : null}

      <p className="sf-field-hint">
        {isActive
          ? 'This unresolved case keeps the physical unit out of service. The repair estimate is operational evidence only and is not an amount due from the customer.'
          : 'This case is terminal. Returning the unit to service remains an explicit inventory decision because maintenance or another operational hold may still exist.'}
      </p>
    </section>

    {canReadLiability && hasClosedAssessedAuthority ? <RentalDamageLiabilityPanel
      bookingId={bookingId}
      damageCaseId={damageCase.id}
      currency={damageCase.currency}
      estimatedRepairCostMinor={damageCase.estimatedRepairCostMinor as bigint}
      decision={liabilityDecision}
      canManage={canManageLiability}
    /> : null}
  </>;
}
