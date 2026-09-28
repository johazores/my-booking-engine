'use client';

import { useCallback, useEffect, useState } from 'react';

import { readPublicBookingDocumentCapability } from './public-booking-document-capability.ts';

type PublicReceipt = {
  receiptNumber: string;
  issuedAt: string;
  organization: { name: string };
  booking: {
    currency: string;
    arrivalDate: string;
    departureDate: string;
    roomTypeName: string;
    ratePlanName: string;
    accommodationSubtotalMinor: string;
    taxTotalMinor: string;
    feeTotalMinor: string;
    addonTotalMinor: string;
    totalMinor: string;
  };
  settlement: {
    capturedMinor: string;
    refundedMinor: string;
    netPaidMinor: string;
  };
  activity: Array<{ kind: 'PAYMENT' | 'REFUND'; amountMinor: string; createdAt: string }>;
  note: string;
};

function formatMinor(amountMinor: string, currency: string) {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const scale = 10n ** BigInt(fractionDigits);
  const minor = BigInt(amountMinor);
  const whole = minor / scale;
  const fraction = minor % scale;
  return fractionDigits === 0
    ? `${currency} ${whole.toString()}`
    : `${currency} ${whole.toString()}.${fraction.toString().padStart(fractionDigits, '0')}`;
}

export function PublicBookingSettlementReceipt({ organizationSlug }: { organizationSlug: string }) {
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadReceipt = useCallback(async () => {
    const bookingCapability = readPublicBookingDocumentCapability(organizationSlug);
    if (!bookingCapability) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/payments/receipt`, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability }),
      });
      if (response.status === 404 || response.status === 409) return;
      if (!response.ok) {
        setError('Payment receipt could not be verified right now.');
        return;
      }
      const data = await response.json() as PublicReceipt;
      setReceipt(data);
    } catch {
      setError('Payment receipt could not be loaded right now.');
    } finally {
      setBusy(false);
    }
  }, [organizationSlug]);

  useEffect(() => {
    void loadReceipt();
  }, [loadReceipt]);

  if (!receipt) {
    if (!error && !busy) return null;

    return (
      <section
        className="sf-public-booking__search-card"
        aria-labelledby="payment-receipt-title"
        aria-busy={busy || undefined}
      >
        <div className="sf-public-booking__section-heading">
          <div>
            <p className="sf-public-booking__eyebrow">Payment record</p>
            <h2 id="payment-receipt-title">Payment receipt</h2>
          </div>
        </div>
        {busy ? <p className="sf-public-booking__notice" role="status">Loading payment receipt…</p> : null}
        {error ? <p className="sf-public-booking__alert" role="alert">{error}</p> : null}
        {error ? (
          <button
            type="button"
            className="sf-public-booking__contact"
            onClick={loadReceipt}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? 'Trying again…' : 'Try again'}
          </button>
        ) : null}
      </section>
    );
  }

  const currency = receipt.booking.currency;
  return (
    <section
      className="sf-public-booking__search-card"
      aria-labelledby="payment-receipt-title"
      aria-busy={busy || undefined}
    >
      <div className="sf-public-booking__section-heading">
        <div>
          <p className="sf-public-booking__eyebrow">Payment record</p>
          <h2 id="payment-receipt-title">Payment receipt</h2>
        </div>
        <span>{receipt.receiptNumber}</span>
      </div>
      {error ? <p className="sf-public-booking__alert" role="alert">{error}</p> : null}
      <dl className="sf-public-booking__facts">
        <div><dt>Stay</dt><dd>{receipt.booking.arrivalDate} → {receipt.booking.departureDate}</dd></div>
        <div><dt>Room</dt><dd>{receipt.booking.roomTypeName}</dd></div>
        <div><dt>Rate</dt><dd>{receipt.booking.ratePlanName}</dd></div>
        <div><dt>Issued</dt><dd>{new Date(receipt.issuedAt).toLocaleString()}</dd></div>
      </dl>
      <dl className="sf-public-booking__facts">
        <div><dt>Accommodation</dt><dd>{formatMinor(receipt.booking.accommodationSubtotalMinor, currency)}</dd></div>
        <div><dt>Tax total</dt><dd>{formatMinor(receipt.booking.taxTotalMinor, currency)}</dd></div>
        <div><dt>Fee total</dt><dd>{formatMinor(receipt.booking.feeTotalMinor, currency)}</dd></div>
        <div><dt>Add-ons</dt><dd>{formatMinor(receipt.booking.addonTotalMinor, currency)}</dd></div>
        <div><dt>Booking total</dt><dd>{formatMinor(receipt.booking.totalMinor, currency)}</dd></div>
        <div><dt>Net paid</dt><dd>{formatMinor(receipt.settlement.netPaidMinor, currency)}</dd></div>
      </dl>
      {receipt.settlement.refundedMinor !== '0' ? (
        <p className="sf-public-booking__notice">Refunded: {formatMinor(receipt.settlement.refundedMinor, currency)}</p>
      ) : null}
      {receipt.activity.length > 0 ? (
        <div className="sf-public-booking__rate">
          <strong>Settlement activity</strong>
          {receipt.activity.map((entry, index) => (
            <p key={`${entry.kind}:${entry.createdAt}:${index}`}>
              {entry.kind === 'REFUND' ? 'Refund' : 'Payment'} · {formatMinor(entry.amountMinor, currency)} · {new Date(entry.createdAt).toLocaleString()}
            </p>
          ))}
        </div>
      ) : null}
      <p className="sf-public-booking__contact-note">{receipt.note}</p>
      <button
        type="button"
        className="sf-public-booking__contact"
        onClick={loadReceipt}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? 'Refreshing…' : 'Refresh receipt'}
      </button>
    </section>
  );
}
