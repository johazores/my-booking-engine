import Link from 'next/link';

export function RentalCustodyExtensionPanel({
  bookingId,
  canReview,
}: Readonly<{
  bookingId: string;
  canReview: boolean;
}>) {
  return <section className="sf-inventory-card" aria-labelledby="rental-custody-extension-title">
    <div className="sf-inventory-card__heading">
      <div>
        <p className="sf-eyebrow">Open custody</p>
        <h2 id="rental-custody-extension-title">Rental extension</h2>
      </div>
      <span>Same unit</span>
    </div>
    <p className="sf-field-hint">
      While pickup custody is open, SF can review only a current-start, later-end extension that keeps the effective physical unit and accepted aggregate price unchanged. Inventory, custody, pricing, and permissions are revalidated server-side before anything is applied.
    </p>
    {canReview
      ? <Link className="sf-button sf-button--secondary" href={`/inventory/rentals/bookings/${bookingId}/reschedule`}>Extend rental</Link>
      : <p className="sf-field-hint">Your role cannot start the extension review from this booking.</p>}
  </section>;
}
