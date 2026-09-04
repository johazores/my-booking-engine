'use client';

import Link from 'next/link';

export default function InvoicesError({ reset }: { reset: () => void }) {
  return <div className="sf-invoice-page"><section className="sf-invoice-error" role="alert"><p className="sf-eyebrow">Legal documents</p><h1>Tax invoices could not be loaded</h1><p>The invoice register could not verify or load the requested issued-document evidence.</p><div className="sf-actions"><button className="sf-button" type="button" onClick={reset}>Try again</button><Link className="sf-button sf-button--secondary" href="/bookings">Back to bookings</Link></div></section></div>;
}
