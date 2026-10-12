import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRentalEffectiveRefundSourceOrder } from './rental-booking-effective-refund-order-domain.ts';

const at = (milliseconds: number) => new Date(1_700_000_000_000 + milliseconds);
const row = (sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT', amountMinor: bigint, milliseconds: number) => ({
  sourceLedger, amountMinor, createdAt: at(milliseconds),
});

const check = (direction: 'ADDITIONAL_CHARGE' | 'REFUND', rows: ReturnType<typeof row>[]) =>
  validateRentalEffectiveRefundSourceOrder({ direction, deltaMinor: 200n, rows });

test('accepts fully refunded amendment charge before original-source refunds', () => {
  assert.equal(check('ADDITIONAL_CHARGE', [row('BOOKING_PRICE', 100n, 30), row('COMMERCIAL_AMENDMENT', 200n, 10)]), null);
  assert.equal(check('ADDITIONAL_CHARGE', [row('COMMERCIAL_AMENDMENT', 80n, 10), row('BOOKING_PRICE', 50n, 30), row('COMMERCIAL_AMENDMENT', 120n, 20)]), null);
});

test('rejects booking-price refund even if a later charge refund makes final balances reconcile', () => {
  assert.match(check('ADDITIONAL_CHARGE', [row('COMMERCIAL_AMENDMENT', 200n, 30), row('BOOKING_PRICE', 50n, 10)]) ?? '', /predate/);
  assert.match(check('ADDITIONAL_CHARGE', [row('COMMERCIAL_AMENDMENT', 100n, 10), row('BOOKING_PRICE', 50n, 20), row('COMMERCIAL_AMENDMENT', 100n, 30)]) ?? '', /predate/);
});

test('decrease amendments allow original-source refunds but reject charge-source evidence', () => {
  assert.equal(check('REFUND', [row('BOOKING_PRICE', 100n, 10)]), null);
  assert.match(check('REFUND', [row('COMMERCIAL_AMENDMENT', 10n, 10)]) ?? '', /decrease amendment/);
});

test('same-millisecond refunds are checked as one timestamp group', () => {
  assert.equal(check('ADDITIONAL_CHARGE', [row('BOOKING_PRICE', 1n, 10), row('COMMERCIAL_AMENDMENT', 200n, 10)]), null);
  assert.match(check('ADDITIONAL_CHARGE', [row('BOOKING_PRICE', 1n, 10), row('COMMERCIAL_AMENDMENT', 199n, 10)]) ?? '', /predate/);
});

test('rejects over-refund and malformed retained chronology', () => {
  assert.match(check('ADDITIONAL_CHARGE', [row('COMMERCIAL_AMENDMENT', 201n, 10)]) ?? '', /exceed/);
  assert.match(check('ADDITIONAL_CHARGE', [{ ...row('BOOKING_PRICE', 50n, 10), createdAt: new Date(NaN) }]) ?? '', /malformed/);
  assert.match(validateRentalEffectiveRefundSourceOrder({ direction: 'ADDITIONAL_CHARGE', deltaMinor: 0n, rows: [] }) ?? '', /invalid amendment/);
  assert.match(validateRentalEffectiveRefundSourceOrder({ direction: 'INVALID' as never, deltaMinor: 200n, rows: [] }) ?? '', /invalid amendment/);
  assert.match(validateRentalEffectiveRefundSourceOrder({ direction: 'ADDITIONAL_CHARGE', deltaMinor: '200' as never, rows: [] }) ?? '', /invalid amendment/);
  assert.match(validateRentalEffectiveRefundSourceOrder({ direction: 'ADDITIONAL_CHARGE', deltaMinor: 200n, rows: [{ ...row('BOOKING_PRICE', 1n, 10), amountMinor: 1 as never }] }) ?? '', /malformed/);
  assert.match(validateRentalEffectiveRefundSourceOrder({ direction: 'ADDITIONAL_CHARGE', deltaMinor: 200n, rows: [{ ...row('BOOKING_PRICE', 1n, 10), sourceLedger: 'INVALID' as never }] }) ?? '', /malformed/);
});
