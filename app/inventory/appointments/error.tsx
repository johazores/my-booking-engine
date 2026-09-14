'use client';

import Link from 'next/link';

export default function AppointmentInventoryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="sf-inventory-page">
    <section className="sf-inventory-card" role="alert">
      <p className="sf-eyebrow">Appointment inventory</p>
      <h1>Appointment inventory could not be loaded</h1>
      <p>The requested tenant-owned appointment inventory could not be verified or loaded.</p>
      <div className="sf-actions">
        <button className="sf-button sf-button--primary" type="button" onClick={reset}>Try again</button>
        <Link className="sf-button sf-button--secondary" href="/inventory">Back to inventory</Link>
      </div>
    </section>
  </div>;
}
