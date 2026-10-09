import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../app/book/[organization-slug]/', import.meta.url);

async function loadGuards(filename, startMarker, endMarker, names) {
  const source = await readFile(new URL(filename, root), 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'Expected production validators in ' + filename);
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics ?? [], []);
  return new Function(compiled.outputText + '\nreturn { ' + names.join(', ') + ' };')();
}

const { isPublicReceipt } = await loadGuards(
  'public-booking-receipt.tsx', 'function isRecord(', 'export function PublicBookingSettlementReceipt(', ['isPublicReceipt'],
);
const { isPaymentRecoveryStatus, isCheckoutResponse } = await loadGuards(
  'public-booking-flow.tsx', 'function isPaymentRecoveryStatus(', 'function formatMinor(', ['isPaymentRecoveryStatus', 'isCheckoutResponse'],
);

const receipt = {
  documentType: 'PAYMENT_RECEIPT',
  receiptNumber: 'R-001',
  issuedAt: '2026-10-08T00:00:00Z',
  organization: { name: 'Example Hotel' },
  booking: {
    currency: 'AUD', arrivalDate: '2026-10-08', departureDate: '2026-10-09',
    roomTypeName: 'Standard', ratePlanName: 'Flexible',
    accommodationSubtotalMinor: '10000', taxTotalMinor: '1000',
    feeTotalMinor: '0', addonTotalMinor: '0', totalMinor: '11000',
  },
  settlement: { capturedMinor: '11000', refundedMinor: '0', netPaidMinor: '11000' },
  activity: [{ kind: 'PAYMENT', amountMinor: '11000', createdAt: '2026-10-08T00:00:00Z' }],
  note: 'Settlement record',
};

test('public receipt requires valid nested booking, money, and activity', () => {
  assert.equal(isPublicReceipt(receipt), true);
  for (const invalid of [
    null, [], {},
    { ...receipt, booking: null },
    { ...receipt, booking: { ...receipt.booking, totalMinor: '-1' } },
    { ...receipt, booking: { ...receipt.booking, currency: 'invalid' } },
    { ...receipt, settlement: { ...receipt.settlement, netPaidMinor: null } },
    { ...receipt, activity: [{ kind: 'REFUND', amountMinor: {}, createdAt: 'today' }] },
    { ...receipt, issuedAt: 'not-a-date' },
    { ...receipt, documentType: 'TAX_INVOICE' },
  ]) assert.equal(isPublicReceipt(invalid), false);
});

test('payment status requires known state and boolean continuation evidence', () => {
  for (const state of ['PAYMENT_REQUIRED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'])
    assert.equal(isPaymentRecoveryStatus({ state, canResumeCheckout: false, canContinuePayment: true }), true);
  for (const invalid of [null, [], {}, { state: 'PROCESSING' },
    { state: 'UNKNOWN', canResumeCheckout: false, canContinuePayment: false },
    { state: 'PAID', canResumeCheckout: 'false', canContinuePayment: false },
    { state: 'PAID', canResumeCheckout: false, canContinuePayment: null }])
    assert.equal(isPaymentRecoveryStatus(invalid), false);
});

test('Checkout requires a recognized state and URL for redirect', () => {
  assert.equal(isCheckoutResponse({ state: 'CHECKOUT_REQUIRED', checkoutUrl: 'https://checkout.stripe.com/example' }), true);
  assert.equal(isCheckoutResponse({ state: 'PAID' }), true);
  assert.equal(isCheckoutResponse({ state: 'PROCESSING' }), true);
  for (const invalid of [null, [], {}, { state: 'CHECKOUT_REQUIRED' },
    { state: 'CHECKOUT_REQUIRED', checkoutUrl: '' }, { state: 'UNKNOWN' }])
    assert.equal(isCheckoutResponse(invalid), false);
});
