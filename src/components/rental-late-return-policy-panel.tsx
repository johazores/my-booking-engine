import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readRentalLateReturnPolicy } from '@/server/pricing/rental-late-return-policy-service.ts';

export async function RentalLateReturnPolicyPanel({
  organizationId,
  actorUserId,
  unitTypeId,
}: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitTypeId: string;
}>) {
  const authorization = await readOrganizationAuthorization({ organizationId, userId: actorUserId });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  if (!hasPermission('inventory:read') || !hasPermission('pricing:read')) return null;

  const canManage = hasPermission('pricing:manage');
  const { unitType, revision } = await readRentalLateReturnPolicy({
    organizationId,
    actorUserId,
    unitTypeId,
  });
  const expectedVersion = revision?.version ?? 0;
  const active = Boolean(revision?.enabled);
  const dailyFee = revision?.dailyFeeMinor == null
    ? null
    : `${revision.currency} ${moneyMinorToMajorString(revision.dailyFeeMinor, revision.currency)}`;

  return <section className="sf-inventory-card" aria-labelledby="rental-late-return-policy-title">
    <div className="sf-inventory-card__heading">
      <div>
        <p className="sf-eyebrow">Commercial policy</p>
        <h2 id="rental-late-return-policy-title">Late-return fee policy</h2>
      </div>
      <span>{active ? `Active · v${revision?.version}` : revision ? `Disabled · v${revision.version}` : 'Not configured'}</span>
    </div>

    {active && revision ? <ul className="sf-inventory-list">
      <li><div className="sf-inventory-list__primary"><div>
        <strong>{dailyFee} per chargeable late day</strong>
        <span>{revision.graceDays} grace day{revision.graceDays === 1 ? '' : 's'} · {unitType.currency} bookings for this unit type</span>
        <span>Effective <time dateTime={revision.effectiveAt.toISOString()}>{revision.effectiveAt.toISOString()}</time> · append-only revision</span>
        <span>{revision.reason}</span>
      </div></div></li>
    </ul> : <p className="sf-field-hint">No automatic fee rule is active for this rental unit type. Late-return commercial assessment remains an explicit staff decision until an enabled revision applies.</p>}

    {canManage ? <div className="sf-inventory-layout">
      <form className="sf-form" method="post" action={`/api/inventory/rentals/unit-types/${unitType.id}/late-return-policy`} aria-describedby="rental-late-return-policy-hint">
        <input type="hidden" name="mode" value="ENABLE" />
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
        <label className="sf-field">Grace days<input name="graceDays" type="number" min="0" max="30" step="1" defaultValue={active && revision ? revision.graceDays : 0} required /></label>
        <label className="sf-field">Daily late fee ({unitType.currency})<input name="dailyFeeAmountMajor" inputMode="decimal" defaultValue={active && revision?.dailyFeeMinor != null ? moneyMinorToMajorString(revision.dailyFeeMinor, unitType.currency) : ''} required /></label>
        <label className="sf-field">Change reason<textarea name="reason" maxLength={1000} rows={3} required /></label>
        <p id="rental-late-return-policy-hint" className="sf-field-hint">Saving creates a new immutable policy revision. A return uses the latest revision that was already effective at its retained return time, so later policy changes never reprice historical returns.</p>
        <button className="sf-button sf-button--primary" type="submit">{active ? 'Save new policy revision' : 'Enable late-return policy'}</button>
      </form>
      {active ? <form className="sf-form" method="post" action={`/api/inventory/rentals/unit-types/${unitType.id}/late-return-policy`}>
        <input type="hidden" name="mode" value="DISABLE" />
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
        <label className="sf-field">Disable reason<textarea name="reason" maxLength={1000} rows={3} required /></label>
        <p className="sf-field-hint">Disabling is also an append-only revision. It affects only returns occurring after the disabled revision becomes effective.</p>
        <button className="sf-button sf-button--secondary" type="submit">Disable policy</button>
      </form> : null}
    </div> : <p className="sf-field-hint">Your role can view this policy but cannot revise pricing policy.</p>}
  </section>;
}
