'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { readPublicBookingDocumentCapability, usePublicBookingDocumentCapability } from './public-booking-document-capability.ts';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMinor(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)?$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}

function hasConsistentSettlementMoney(value: Record<string, unknown>): boolean {
  const settlement = value.settlement as PublicReceipt['settlement'];
  const activity = value.activity as PublicReceipt['activity'];
  const captured = BigInt(settlement.capturedMinor);
  const refunded = BigInt(settlement.refundedMinor);
  const payments = activity.reduce((sum, entry) => sum + (entry.kind === 'PAYMENT' ? BigInt(entry.amountMinor) : 0n), 0n);
  const refunds = activity.reduce((sum, entry) => sum + (entry.kind === 'REFUND' ? BigInt(entry.amountMinor) : 0n), 0n);
  return captured > 0n && refunded <= captured
    && captured - refunded === BigInt(settlement.netPaidMinor)
    && payments === captured && refunds === refunded;
}


function hasConsistentBookingMoney(value: Record<string, unknown>): boolean {
  const booking = value.booking as PublicReceipt['booking'];
  return BigInt(booking.totalMinor) > 0n
    && BigInt(booking.accommodationSubtotalMinor) + BigInt(booking.taxTotalMinor)
      + BigInt(booking.feeTotalMinor) + BigInt(booking.addonTotalMinor) === BigInt(booking.totalMinor);
}

function hasConsistentReceiptChronology(value: Record<string, unknown>): boolean {
  const booking = value.booking as PublicReceipt['booking'];
  const activity = value.activity as PublicReceipt['activity'];
  const issuedAt = Date.parse(value.issuedAt as string);
  return booking.arrivalDate < booking.departureDate
    && activity.every((entry, index) => {
      const createdAt = Date.parse(entry.createdAt);
      return createdAt <= issuedAt && (index === 0 || Date.parse(activity[index - 1].createdAt) <= createdAt);
    });
}

function isPublicReceipt(value: unknown): value is PublicReceipt {
  if (!isRecord(value) || !isRecord(value.organization) || !isRecord(value.booking) || !isRecord(value.settlement)) return false;
  const booking = value.booking;
  const settlement = value.settlement;
  return value.documentType === 'PAYMENT_RECEIPT'
    && typeof value.receiptNumber === 'string' && value.receiptNumber.length > 0
    && isDate(value.issuedAt)
    && typeof value.organization.name === 'string'
    && typeof value.note === 'string'
    && typeof booking.currency === 'string' && /^[A-Z]{3}$/.test(booking.currency)
    && isDate(booking.arrivalDate) && isDate(booking.departureDate)
    && typeof booking.roomTypeName === 'string' && typeof booking.ratePlanName === 'string'
    && ['accommodationSubtotalMinor', 'taxTotalMinor', 'feeTotalMinor', 'addonTotalMinor', 'totalMinor']
      .every((key) => isMinor(booking[key]))
    && ['capturedMinor', 'refundedMinor', 'netPaidMinor'].every((key) => isMinor(settlement[key]))
    && Array.isArray(value.activity)
    && value.activity.every((entry: unknown) => isRecord(entry)
      && (entry.kind === 'PAYMENT' || entry.kind === 'REFUND')
      && isMinor(entry.amountMinor) && BigInt(entry.amountMinor) > 0n && isDate(entry.createdAt))
    && hasConsistentSettlementMoney(value)
    && hasConsistentBookingMoney(value)
    && hasConsistentReceiptChronology(value);
}

export function PublicBookingSettlementReceipt({ organizationSlug }: { organizationSlug: string }) {
  const bookingCapability = usePublicBookingDocumentCapability(organizationSlug);
  const [receiptState, setReceiptState] = useState<{ capability: string; value: PublicReceipt } | null>(null);
  const [errorState, setErrorState] = useState<{ capability: string; message: string } | null>(null);
  const [busyCapability, setBusyCapability] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const loadReceipt = useCallback(async () => {
    if (!bookingCapability) return;
    const generation = ++requestGeneration.current;
    const isCurrent = () => generation === requestGeneration.current
      && readPublicBookingDocumentCapability(organizationSlug) === bookingCapability;

    setBusyCapability(bookingCapability);
    setErrorState(null);
    try {
      const response = await fetch(`/api/public-bookings/${encodeURIComponent(organizationSlug)}/hospitality/payments/receipt`, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ bookingCapability }),
      });
      if (!isCurrent()) return;
      if (response.status === 404 || response.status === 409) {
        setReceiptState(null);
        return;
      }
      if (!response.ok) {
        setErrorState({ capability: bookingCapability, message: 'Payment receipt could not be verified right now.' });
        return;
      }
      const data: unknown = await response.json();
      if (!isCurrent()) return;
      if (!isPublicReceipt(data)) throw new Error('Malformed payment receipt response');
      setReceiptState({ capability: bookingCapability, value: data });
    } catch {
      if (isCurrent()) setErrorState({ capability: bookingCapability, message: 'Payment receipt could not be loaded right now.' });
    } finally {
      if (isCurrent()) setBusyCapability(null);
    }
  }, [bookingCapability, organizationSlug]);

  useEffect(() => {
    void loadReceipt();
    return () => { requestGeneration.current += 1; };
  }, [loadReceipt]);

  // A new booking must never render the previous booking's receipt, even for one frame.
  const receipt = receiptState?.capability === bookingCapability ? receiptState.value : null;
  const error = errorState?.capability === bookingCapability ? errorState.message : null;
  const busy = Boolean(bookingCapability && busyCapability === bookingCapability);

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
