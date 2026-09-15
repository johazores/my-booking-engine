type RentalBookingCancelActionProps = {
  bookingId: string;
};

export function RentalBookingCancelAction({ bookingId }: RentalBookingCancelActionProps) {
  return <details className="sf-empty-state">
    <summary className="sf-button sf-button--secondary">Cancel rental booking</summary>
    <div>
      <h3>Confirm cancellation</h3>
      <p>Cancelling releases this physical unit and date range back to rental availability. The booking, allocation, commercial evidence, customer snapshot, and audit history are retained.</p>
      <p>This action does not collect, refund, or change money because rental payment and deposit workflows are not implemented.</p>
      <form action={`/api/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/cancel`} method="post">
        <button className="sf-button" type="submit">Confirm cancellation</button>
      </form>
    </div>
  </details>;
}
