import { readAuthSessionState } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  readRentalBookingEffectiveSettlement,
  RentalBookingEffectiveSettlementUnavailableError,
} from '@/server/bookings/rental-booking-effective-settlement-service.ts';
import type { RentalPaymentSettlement } from '@/server/payments/rental-payment-domain.ts';
import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

type RentalBookingCancelActionProps = {
  bookingId: string;
  bookingCurrency: string;
  settlement: RentalPaymentSettlement | null;
};

export async function RentalBookingCancelAction({
  bookingId,
  bookingCurrency,
  settlement: bookingPriceSettlement,
}: RentalBookingCancelActionProps) {
  if (!bookingPriceSettlement) {
    return <div className="sf-empty-state">
      <h3>Settlement verification required</h3>
      <p>Cancellation stays blocked until an authorized payment reader can verify that the effective rental settlement reconciles to zero.</p>
      <p className="sf-field-hint">No payment amount is exposed without payment-read permission. The server still enforces the complete financial guard when cancellation is submitted.</p>
    </div>;
  }

  let settlement: Awaited<ReturnType<typeof readRentalBookingEffectiveSettlement>>['settlement'] | null = null;
  const authState = await readAuthSessionState();
  if (authState.session) {
    const activeContext = await readActiveOrganizationContext(authState.session.user.id);
    if (activeContext.organization) {
      try {
        const effective = await readRentalBookingEffectiveSettlement({
          organizationId: activeContext.organization.id,
          actorUserId: authState.session.user.id,
          bookingId,
        });
        settlement = effective.settlement;
      } catch (error) {
        if (
          !(error instanceof RentalBookingEffectiveSettlementUnavailableError)
          && !(error instanceof OrganizationPermissionDeniedError)
        ) throw error;
      }
    }
  }

  if (!settlement) {
    return <div className="sf-empty-state">
      <h3>Settlement verification required</h3>
      <p>Cancellation stays blocked until the effective rental settlement can be verified in the active organization.</p>
      <p className="sf-field-hint">Refresh the booking after confirming tenant access and payment-read authority. Cancellation does not bypass missing settlement evidence.</p>
    </div>;
  }

  if (!settlement.reconciled) {
    return <div className="sf-empty-state">
      <h3>Payment reconciliation required</h3>
      <p>The retained rental settlement evidence does not currently reconcile, so cancellation cannot release inventory.</p>
      <p className="sf-field-hint">Resolve the payment, commercial-amendment, or post-apply refund evidence first. Cancellation never fabricates a refund or bypasses unresolved settlement.</p>
    </div>;
  }

  if (settlement.currency !== bookingCurrency) {
    return <div className="sf-empty-state">
      <h3>Settlement verification required</h3>
      <p>The effective rental settlement currency does not match the retained booking currency.</p>
      <p className="sf-field-hint">Treat this as a commercial integrity incident. Cancellation remains blocked.</p>
    </div>;
  }

  if (settlement.currentNetSettledMinor > 0n) {
    return <div className="sf-empty-state">
      <h3>Refund effective rental settlement first</h3>
      <p>Retain real refund evidence for the remaining {settlement.currency} {moneyMinorToMajorString(settlement.currentNetSettledMinor, settlement.currency)} before cancelling this rental.</p>
      <p className="sf-field-hint">
        {settlement.appliedAmendment
          ? 'This booking has an applied commercial amendment, so remaining money must be refunded through the adjustment-aware effective settlement contract. Cancellation itself never moves money.'
          : 'Use the payment settlement section to record each real external refund. Cancellation itself does not move money or assume a refund occurred.'}
      </p>
    </div>;
  }

  if (!settlement.fullyRefunded) {
    return <div className="sf-empty-state">
      <h3>Settlement verification required</h3>
      <p>The effective rental settlement is not in a fully refunded terminal state.</p>
      <p className="sf-field-hint">Cancellation fails closed until retained commercial evidence proves an exact zero effective net.</p>
    </div>;
  }

  return <details className="sf-empty-state">
    <summary className="sf-button sf-button--secondary">Cancel rental booking</summary>
    <div>
      <h3>Confirm cancellation</h3>
      <p>Cancelling releases this physical unit and date range back to rental availability. The booking, allocation, commercial evidence, customer snapshot, and audit history are retained.</p>
      <p>Effective rental settlement is reconciled to zero. This cancellation action does not collect, refund, or change money; it also does not create a fee, provider action, security-bond disposition, notification, or external synchronization.</p>
      <p className="sf-field-hint">The server will recheck effective settlement, custody, allocation, tenant, and other cancellation guards before committing the lifecycle change.</p>
      <form className="sf-form" action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/cancel`} method="post">
        <label className="sf-field">
          Cancellation reason
          <textarea
            name="reason"
            maxLength={1000}
            rows={4}
            required
            aria-describedby="rental-booking-cancellation-reason-hint"
          />
        </label>
        <p id="rental-booking-cancellation-reason-hint" className="sf-field-hint">
          Required for durable audit evidence. Describe the real operational or customer reason; do not enter payment-card or other sensitive secrets.
        </p>
        <button className="sf-button" type="submit">Confirm cancellation</button>
      </form>
    </div>
  </details>;
}
