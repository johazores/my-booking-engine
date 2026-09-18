import { moneyMinorToMajorString } from '@/server/pricing/money.ts';
import type { RentalPaymentSettlement } from '@/server/payments/rental-payment-domain.ts';

type RentalBookingCancelActionProps = {
  bookingId: string;
  bookingCurrency: string;
  settlement: RentalPaymentSettlement | null;
};

export function RentalBookingCancelAction({
  bookingId,
  bookingCurrency,
  settlement,
}: RentalBookingCancelActionProps) {
  if (!settlement) {
    return <div className="sf-empty-state">
      <h3>Settlement verification required</h3>
      <p>Cancellation stays blocked until an authorized payment reader can verify that booking-price settlement reconciles to zero.</p>
      <p className="sf-field-hint">No payment amount is exposed without payment-read permission. The server still enforces the financial guard when cancellation is submitted.</p>
    </div>;
  }

  if (!settlement.reconciled) {
    return <div className="sf-empty-state">
      <h3>Payment reconciliation required</h3>
      <p>The retained booking-price payment history does not currently reconcile, so cancellation cannot release inventory.</p>
      <p className="sf-field-hint">Resolve the payment evidence first. Cancellation never fabricates a refund or bypasses unresolved settlement.</p>
    </div>;
  }

  if (settlement.netSettledMinor > 0n) {
    return <div className="sf-empty-state">
      <h3>Refund booking-price settlement first</h3>
      <p>Record real refund evidence for the remaining {bookingCurrency} {moneyMinorToMajorString(settlement.netSettledMinor, bookingCurrency)} before cancelling this rental.</p>
      <p className="sf-field-hint">Use the payment settlement section to record each real external refund. Cancellation itself does not move money or assume a refund occurred.</p>
    </div>;
  }

  return <details className="sf-empty-state">
    <summary className="sf-button sf-button--secondary">Cancel rental booking</summary>
    <div>
      <h3>Confirm cancellation</h3>
      <p>Cancelling releases this physical unit and date range back to rental availability. The booking, allocation, commercial evidence, customer snapshot, and audit history are retained.</p>
      <p>Booking-price settlement is reconciled to zero. This cancellation action does not collect, refund, or change money; it also does not create a fee, provider action, security-bond disposition, notification, or external synchronization.</p>
      <p className="sf-field-hint">The server will recheck payment, custody, allocation, tenant, and other cancellation guards before committing the lifecycle change.</p>
      <form action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/cancel`} method="post">
        <button className="sf-button" type="submit">Confirm cancellation</button>
      </form>
    </div>
  </details>;
}
