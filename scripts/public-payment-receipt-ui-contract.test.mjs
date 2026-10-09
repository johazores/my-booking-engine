import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const receiptUi = await readFile(
  new URL('../app/book/[organization-slug]/public-booking-receipt.tsx', import.meta.url),
  'utf8',
);

test('public payment receipt has recoverable loading and retry states', () => {
  assert.match(receiptUi, /Payment receipt could not be verified right now/);
  assert.match(receiptUi, /Payment receipt could not be loaded right now/);
  assert.match(receiptUi, /role="status"/);
  assert.match(receiptUi, /role="alert"/);
  assert.match(receiptUi, /Try again/);
  assert.doesNotMatch(receiptUi, /setReceipt\(null\)/);
});

test('receipt client rejects inconsistent monetary and calendar evidence before rendering', () => {
  assert.match(receiptUi, /function hasConsistentSettlementMoney\(value: Record<string, unknown>\)/);
  assert.match(receiptUi, /captured - refunded === BigInt\(settlement\.netPaidMinor\)/);
  assert.match(receiptUi, /payments === captured && refunds === refunded/);
  assert.match(receiptUi, /hasConsistentSettlementMoney\(value\)/);
  assert.match(receiptUi, /parsed\.toISOString\(\)\.slice\(0, 10\)/);
});

const validatorStart = receiptUi.indexOf('function isRecord(');
const validatorEnd = receiptUi.indexOf('export function PublicBookingSettlementReceipt(', validatorStart);
assert.ok(validatorStart >= 0 && validatorEnd > validatorStart, 'Expected public receipt validators');
const compiled = ts.transpileModule(receiptUi.slice(validatorStart, validatorEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics ?? [], []);
const { isPublicReceipt } = new Function(compiled.outputText + '\nreturn { isPublicReceipt };')();

const validReceipt = {
  documentType: 'PAYMENT_RECEIPT', receiptNumber: 'SF-1234', issuedAt: '2026-10-08T12:00:00Z',
  organization: { name: 'Example Pty Ltd' },
  booking: {
    currency: 'AUD', paymentStatus: 'PAID', arrivalDate: '2026-10-10', departureDate: '2026-10-12',
    roomTypeName: 'Standard', ratePlanName: 'Flexible',
    accommodationSubtotalMinor: '10000', taxTotalMinor: '1000',
    feeTotalMinor: '0', addonTotalMinor: '0', totalMinor: '11000',
  },
  settlement: { capturedMinor: '11000', refundedMinor: '0', netPaidMinor: '11000' },
  activity: [{ kind: 'PAYMENT', amountMinor: '11000', createdAt: '2026-10-08T11:00:00Z' }],
  note: 'Verified payment receipt',
};

test('public receipt accepts consistent booking and payment evidence', () => {
  assert.equal(isPublicReceipt(validReceipt), true);
});

test('public receipt rejects contradictory booking price components and invalid stays', () => {
  for (const booking of [
    { totalMinor: '11001' }, { accommodationSubtotalMinor: '9999' },
    { taxTotalMinor: '1001' }, { departureDate: '2026-10-10' },
    { departureDate: '2026-10-09' },
  ]) assert.equal(isPublicReceipt({ ...validReceipt, booking: { ...validReceipt.booking, ...booking } }), false);
});

test('public receipt rejects activity after issuance or out of chronological order', () => {
  assert.equal(isPublicReceipt({
    ...validReceipt, activity: [{ ...validReceipt.activity[0], createdAt: '2026-10-08T13:00:00Z' }],
  }), false);
  assert.equal(isPublicReceipt({
    ...validReceipt, activity: [
      { kind: 'PAYMENT', amountMinor: '6000', createdAt: '2026-10-08T11:30:00Z' },
      { kind: 'PAYMENT', amountMinor: '5000', createdAt: '2026-10-08T11:00:00Z' },
    ],
  }), false);
  assert.equal(isPublicReceipt({
    ...validReceipt, activity: [
      { kind: 'PAYMENT', amountMinor: '6000', createdAt: '2026-10-08T11:00:00Z' },
      { kind: 'PAYMENT', amountMinor: '5000', createdAt: '2026-10-08T11:30:00Z' },
    ],
  }), true);
});

test('staff and public receipt services enforce the same persisted snapshot guard', async () => {
  for (const path of [
    '../src/server/payments/payment-receipt-service.ts',
    '../src/server/payments/public-payment-receipt-service.ts',
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /assertPaymentReceiptBookingSnapshot\(booking\)/);
  }
});

test('public receipt rejects settlement totals inconsistent with the persisted payment status', () => {
  for (const paymentStatus of ['REFUNDED', 'PARTIALLY_REFUNDED', 'AUTHORIZED']) {
    assert.equal(isPublicReceipt({
      ...validReceipt, booking: { ...validReceipt.booking, paymentStatus },
    }), false);
  }
  assert.equal(isPublicReceipt({
    ...validReceipt,
    booking: { ...validReceipt.booking, paymentStatus: 'PARTIALLY_REFUNDED' },
    settlement: { capturedMinor: '11000', refundedMinor: '3000', netPaidMinor: '8000' },
    activity: [
      { kind: 'PAYMENT', amountMinor: '11000', createdAt: '2026-10-08T10:00:00Z' },
      { kind: 'REFUND', amountMinor: '3000', createdAt: '2026-10-08T11:00:00Z' },
    ],
  }), true);
  assert.equal(isPublicReceipt({
    ...validReceipt,
    booking: { ...validReceipt.booking, paymentStatus: 'REFUNDED' },
    settlement: { capturedMinor: '11000', refundedMinor: '11000', netPaidMinor: '0' },
    activity: [
      { kind: 'PAYMENT', amountMinor: '11000', createdAt: '2026-10-08T10:00:00Z' },
      { kind: 'REFUND', amountMinor: '11000', createdAt: '2026-10-08T11:00:00Z' },
    ],
  }), true);
});
