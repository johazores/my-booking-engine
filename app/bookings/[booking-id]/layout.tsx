import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { BookingCommercialAmendmentAction } from '@/components/booking-commercial-amendment-action.tsx';
import { BookingCommercialAmendmentRecoveryAction } from '@/components/booking-commercial-amendment-recovery-action.tsx';
import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { findHospitalityBookingCommercialAmendmentRecoveryTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-recovery-transport-service.ts';
import { findHospitalityBookingCommercialAmendmentTransport } from '@/server/bookings/hospitality-booking-commercial-amendment-transport-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

export default async function BookingDetailLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ 'booking-id': string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) return children;

  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) return children;
  const bookingId = (await params)['booking-id'];

  let amendment = null;
  let recovery = null;
  try {
    [amendment, recovery] = await Promise.all([
      findHospitalityBookingCommercialAmendmentTransport({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        bookingId,
      }),
      findHospitalityBookingCommercialAmendmentRecoveryTransport({
        organizationId: activeContext.organization.id,
        actorUserId: session.user.id,
        bookingId,
      }),
    ]);
  } catch (error) {
    if (!(error instanceof OrganizationPermissionDeniedError)) throw error;
  }

  return <>
    {amendment ? <div className="sf-inventory-page">
      <section className="sf-booking-card" aria-labelledby="booking-commercial-amendment-title">
        <div className="sf-booking-card__heading">
          <div><p className="sf-eyebrow">Commercial adjustment</p><h2 id="booking-commercial-amendment-title">Prepared booking change</h2></div>
          <span className="sf-status-badge">payment adjustment</span>
        </div>
        <BookingCommercialAmendmentAction bookingId={bookingId} initialStatus={amendment} />
      </section>
    </div> : null}
    {recovery ? <div className="sf-inventory-page">
      <section className="sf-booking-card" aria-labelledby="booking-commercial-recovery-title">
        <div className="sf-booking-card__heading">
          <div><p className="sf-eyebrow">Payment recovery</p><h2 id="booking-commercial-recovery-title">Expired commercial amendment</h2></div>
          <span className="sf-status-badge">recovery required</span>
        </div>
        <BookingCommercialAmendmentRecoveryAction bookingId={bookingId} initialStatus={recovery} />
      </section>
    </div> : null}
    {children}
  </>;
}
