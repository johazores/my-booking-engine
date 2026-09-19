import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync('src/components/rental-booking-payment-panel.tsx', 'utf8');
const effectiveSettlementService = readFileSync('src/server/bookings/rental-booking-effective-settlement-service.ts', 'utf8');
const docs = readFileSync('docs/rental-booking-payment-effective-summary.md', 'utf8');

test('applied rental amendments use the protected effective-settlement reader on booking detail', () => {
  assert.match(panel, /readRentalBookingEffectiveSettlement/);
  assert.match(panel, /ledgerAuthority\?\.amendment\?\.status === 'APPLIED'/);
  assert.match(panel, /effectiveSettlementData = await readRentalBookingEffectiveSettlement\(\{/);
  assert.match(panel, /effectiveSettlementData\?\.appliedAmendment\?\.id === appliedAmendmentId/);
});

test('current staff settlement summary uses combined commercial money and fails closed', () => {
  for (const token of [
    'effectiveAcceptedTotalMinor',
    'currentNetSettledMinor',
    'cancellationRefundRemainingMinor',
    'originalBookingTotalMinor',
    'originalBookingNetSettledMinor',
    'fullyFunded',
    'fullyRefunded',
  ]) assert.match(panel, new RegExp(token));

  assert.match(panel, /Rental effective settlement/);
  assert.match(panel, /RECONCILIATION REQUIRED/);
  assert.match(panel, /original booking-price ledger is not current financial authority after an applied amendment/i);
});

test('original booking-price evidence stays historical and original writes stay authority-gated', () => {
  assert.match(panel, /Original booking-price transaction history/);
  assert.match(panel, /immutable source evidence/);
  assert.match(panel, /const originalLedgerWritable = ledgerAuthority\?\.writable === true/);
  assert.match(panel, /canRecordPayment = confirmed && originalLedgerWritable/);
  assert.match(panel, /canRefund = confirmed && originalLedgerWritable/);
  assert.match(panel, /Open effective settlement/);
});

test('effective settlement remains a tenant-scoped protected read rather than UI authority', () => {
  assert.match(effectiveSettlementService, /permission: 'booking:read'/);
  assert.match(effectiveSettlementService, /permission: 'payment:read'/);
  assert.match(effectiveSettlementService, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(effectiveSettlementService, /isolationLevel: 'RepeatableRead'/);
});

test('documentation defines the applied-amendment summary and fail-closed boundary', () => {
  assert.match(docs, /combined effective settlement instead of using the original ledger payment state/i);
  assert.match(docs, /fails closed with `RECONCILIATION REQUIRED`/i);
  assert.match(docs, /explicitly labelled historical after apply/i);
  assert.match(docs, /does not create a new financial writer/i);
});
