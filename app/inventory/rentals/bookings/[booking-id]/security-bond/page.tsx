import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readRentalSecurityBondForfeiture } from '@/server/payments/rental-security-bond-forfeiture-service.ts';
import { readRentalSecurityBond, RentalSecurityBondUnavailableError } from '@/server/payments/rental-security-bond-service.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const statuses: Record<string, string> = {
  'bond-required': 'Security bond requirement recorded.',
  'bond-requirement-existing': 'The same security bond requirement was already recorded.',
  'bond-collected': 'Real manual/offline security bond collection recorded.',
  'bond-collection-existing': 'The same security bond collection was already recorded.',
  'bond-released': 'Real manual/offline security bond release recorded.',
  'bond-release-existing': 'The same security bond release was already recorded.',
  'bond-forfeited': 'Collected security bond was explicitly forfeited against the exact retained customer damage liability.',
  'bond-forfeiture-existing': 'The same security bond forfeiture was already retained.',
};

const errors: Record<string, string> = {
  permission: 'Your organization role cannot manage this security bond.',
  conflict: 'The booking or retained security bond evidence changed. Review the current state before trying again.',
  unavailable: 'This rental booking or security bond is no longer available in the active organization.',
  validation: 'The security bond amount, external reference, or confirmation was invalid.',
  server: 'The security bond operation could not be completed. No successful evidence was recorded.',
};

export default async function RentalSecurityBondPage({ params, searchParams }: {
  params: Promise<{ 'booking-id': string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated rental security bond guard returned without a session');

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const hasPermission = (permission: Parameters<typeof organizationRoleHasPermission>[1]) => Boolean(
    authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, permission)),
  );
  const canRead = hasPermission('booking:read') && hasPermission('payment:read');
  const canManage = hasPermission('booking:manage') && hasPermission('payment:manage');
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental security bond</p><h1>Security bond access is restricted</h1><p>Your organization role needs booking and payment read access.</p></section>;

  const { 'booking-id': bookingId } = await params;
  const query = await searchParams;
  let data: Awaited<ReturnType<typeof readRentalSecurityBond>>;
  let forfeitureData: Awaited<ReturnType<typeof readRentalSecurityBondForfeiture>>;
  try {
    [data, forfeitureData] = await Promise.all([
      readRentalSecurityBond({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId }),
      readRentalSecurityBondForfeiture({ organizationId: activeContext.organization.id, actorUserId: session.user.id, bookingId }),
    ]);
  } catch (error) {
    if (error instanceof RentalSecurityBondUnavailableError) {
      return <section className="sf-inventory-empty"><p className="sf-eyebrow">Rental security bond</p><h1>Booking not available</h1><p>This rental booking does not exist in the active organization.</p><Link className="sf-button sf-button--secondary" href="/inventory/rentals/bookings">Back to rental bookings</Link></section>;
    }
    throw error;
  }

  const effectiveState = forfeitureData.settlement?.state ?? data.settlement?.state ?? null;
  const amount = data.bond ? `${data.bond.currency} ${moneyMinorToMajorString(data.bond.amountMinor, data.bond.currency)}` : null;
  const bondSetupBlocked = canManage
    && data.booking.status === 'CONFIRMED'
    && (!data.bond || effectiveState === 'REQUIRED')
    && !data.preCustodyAuthority.canEstablishOrCollect;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div><p className="sf-eyebrow">Rental security bond</p><h1>{data.booking.customerFirstName} {data.booking.customerLastName}</h1><p>Retained bond requirement, real manual/offline collection and release evidence, and explicit exact-match damage forfeiture authority.</p></div>
      <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${encodeURIComponent(data.booking.id)}`}>Back to booking</Link>
    </header>

    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

    <section className="sf-inventory-card" aria-labelledby="rental-security-bond-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Commercial custody safeguard</p><h2 id="rental-security-bond-title">Security bond</h2></div><span>{effectiveState ?? 'NOT REQUIRED'}</span></div>
      {bondSetupBlocked ? <p className="sf-alert sf-alert--error" role="status"><strong>{data.preCustodyAuthority.hasCustodyEvidence ? 'New security-bond setup is closed after custody begins.' : 'New security-bond setup is closed for this missed pickup.'}</strong> {data.preCustodyAuthority.hasCustodyEvidence ? 'Do not create or collect a new bond after the unit has been handed over.' : 'The exclusive committed rental end has been reached. Reschedule or cancel the booking before requiring or collecting new bond money under a current rental period.'}</p> : null}
      {data.bond && effectiveState ? <>
        <ul className="sf-inventory-list">
          <li><div className="sf-inventory-list__primary"><div><strong>Required {amount}</strong><span>Created <time dateTime={data.bond.createdAt.toISOString()}>{data.bond.createdAt.toISOString()}</time> · immutable requirement</span></div></div></li>
          {data.transactions.map((transaction) => <li key={transaction.id}><div className="sf-inventory-list__primary"><div><strong>{transaction.kind === 'OFFLINE_PAYMENT' ? 'Collected' : 'Released'} {transaction.currency} {moneyMinorToMajorString(transaction.amountMinor, transaction.currency)}</strong><span>Manual reference <code>{transaction.providerReference}</code></span>{transaction.sourceProviderReference ? <span>Collection source <code>{transaction.sourceProviderReference}</code></span> : null}<span><time dateTime={transaction.createdAt.toISOString()}>{transaction.createdAt.toISOString()}</time></span></div></div></li>)}
          {forfeitureData.forfeiture ? <li><div className="sf-inventory-list__primary"><div><strong>Forfeited {forfeitureData.forfeiture.currency} {moneyMinorToMajorString(forfeitureData.forfeiture.amountMinor, forfeitureData.forfeiture.currency)} against retained damage liability</strong><span>This exact full-value disposition is append-only and blocks separate damage settlement for the same liability.</span><span>Recorded <time dateTime={forfeitureData.forfeiture.createdAt.toISOString()}>{forfeitureData.forfeiture.createdAt.toISOString()}</time></span></div></div></li> : null}
        </ul>
        {canManage && data.preCustodyAuthority.canEstablishOrCollect && effectiveState === 'REQUIRED' && data.booking.status === 'CONFIRMED' ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${data.booking.id}/security-bond/collection`}><label className="sf-field"><span>Offline collection reference</span><input name="reference" maxLength={120} required autoComplete="off" /></label><p className="sf-field-hint">Record only after the full {amount} was actually received outside SF. Pickup is blocked while this retained requirement is not actively collected.</p><button className="sf-button sf-button--primary" type="submit">Record bond collection</button></form> : null}
        {canManage && effectiveState === 'COLLECTED' ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${data.booking.id}/security-bond/release`}><label className="sf-field"><span>Offline release reference</span><input name="reference" maxLength={120} required autoComplete="off" /></label><p className="sf-field-hint">Record only after the full {amount} was actually returned outside SF. Cancellation is blocked while the bond remains collected.</p><button className="sf-button sf-button--secondary" type="submit">Record bond release</button></form> : null}
        {canManage && effectiveState === 'COLLECTED' && forfeitureData.eligibility.eligible ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${data.booking.id}/security-bond/forfeiture`} aria-describedby="rental-security-bond-forfeiture-hint"><label className="sf-field"><span>Confirmation</span><input name="confirmation" pattern="[Ff][Oo][Rr][Ff][Ee][Ii][Tt]" placeholder="FORFEIT" required autoComplete="off" /></label><p id="rental-security-bond-forfeiture-hint" className="sf-field-hint">Type FORFEIT only when the full collected {amount} must be applied to the exact same-currency retained customer damage liability. This creates irreversible accounting authority, does not move money, blocks a separate damage payment for that liability, and cannot later be released.</p><button className="sf-button sf-button--danger" type="submit">Forfeit bond against damage liability</button></form> : null}
        {canManage && effectiveState === 'COLLECTED' && !forfeitureData.eligibility.eligible ? <p className="sf-field-hint">Damage forfeiture unavailable: {forfeitureData.eligibility.reason}</p> : null}
      </> : canManage && data.preCustodyAuthority.canEstablishOrCollect && data.booking.status === 'CONFIRMED' ? <form className="sf-inventory-form" method="post" action={`/api/inventory/rentals/bookings/${data.booking.id}/security-bond/requirement`}><label className="sf-field"><span>Required bond amount ({data.booking.currency})</span><input name="amountMajor" inputMode="decimal" required aria-describedby="rental-security-bond-amount-hint" /></label><p id="rental-security-bond-amount-hint" className="sf-field-hint">Create this only when the rental terms actually require a security bond. The requirement is immutable and must be established before custody begins and before the committed pickup window closes.</p><button className="sf-button sf-button--primary" type="submit">Require security bond</button></form> : <p className="sf-field-hint">{bondSetupBlocked ? 'No new security bond requirement is available under the current rental period.' : 'No security bond requirement is retained for this booking.'}</p>}
      {!canManage ? <p className="sf-field-hint">Your role can view security bond evidence but cannot change it.</p> : null}
      <p className="sf-field-hint">This workflow records real manual/offline full-value collection/release evidence and an explicit exact-full-value damage forfeiture only. It does not authorize or capture a card, perform partial offsets, split tenders, or move money. A release remains available for already-collected money even after the pickup window closes because unwinding held customer money must not be suppressed.</p>
    </section>
  </div>;
}
