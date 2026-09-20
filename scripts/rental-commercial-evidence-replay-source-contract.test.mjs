import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const amendmentSettlementService = read('src/server/bookings/rental-booking-commercial-amendment-settlement-service.ts');
const effectiveRefundService = read('src/server/bookings/rental-booking-effective-refund-service.ts');
const docs = read('docs/rental-commercial-evidence-replay.md');

test('commercial amendment adjustment exact replay resolves before fresh prepared and expiry authority', () => {
  const flow = amendmentSettlementService.indexOf('recordRentalBookingCommercialAmendmentManualSettlement');
  const replay = amendmentSettlementService.indexOf("const existing = rows.find((row) => row.purpose === purpose", flow);
  const liveAuthority = amendmentSettlementService.indexOf("amendment.status !== 'PREPARED'", replay);
  const unitLock = amendmentSettlementService.indexOf('rentalUnitLockKey(input.organizationId, amendment.unitId)', liveAuthority);
  const provider = amendmentSettlementService.indexOf('manualProvider.recordOfflinePayment', unitLock);

  assert.ok(replay > flow, 'adjustment replay lookup must exist inside the adjustment writer');
  assert.ok(liveAuthority > replay, 'exact adjustment replay must resolve before fresh PREPARED/expiry authority');
  assert.ok(unitLock > liveAuthority, 'fresh inventory authority must remain after amendment liveness');
  assert.ok(provider > unitLock, 'provider evidence must remain behind all fresh authority checks');
});

test('commercial amendment compensation exact replay survives later cancelled or expired parent lifecycle', () => {
  const flow = amendmentSettlementService.indexOf('recordRentalBookingCommercialAmendmentManualCompensation');
  const replay = amendmentSettlementService.indexOf("const existing = rows.find((row) => row.purpose === purpose", flow);
  const liveAuthority = amendmentSettlementService.indexOf("amendment.status !== 'PREPARED'", replay);
  const provider = amendmentSettlementService.indexOf('manualProvider.recordOfflineRefund', liveAuthority);

  assert.ok(replay > flow, 'compensation replay lookup must exist inside the compensation writer');
  assert.ok(liveAuthority > replay, 'exact compensation replay must resolve before fresh PREPARED authority');
  assert.ok(provider > liveAuthority, 'fresh compensation provider evidence must remain behind live authority');
});

test('post-apply effective refund exact replay resolves before fresh confirmed-booking authority', () => {
  const flow = effectiveRefundService.indexOf('recordRentalBookingPostApplyManualRefund');
  const replay = effectiveRefundService.indexOf('const existing = await transaction.rentalBookingEffectiveRefundTransaction.findFirst', flow);
  const liveAuthority = effectiveRefundService.indexOf("before.booking.status !== 'CONFIRMED'", replay);
  const plan = effectiveRefundService.indexOf('deriveRentalBookingEffectiveRefundPlan', liveAuthority);
  const provider = effectiveRefundService.indexOf('manualProvider.recordOfflineRefund', plan);

  assert.ok(replay > flow, 'post-apply refund replay lookup must exist inside the writer');
  assert.ok(liveAuthority > replay, 'exact retained refund replay must resolve before fresh CONFIRMED booking authority');
  assert.ok(plan > liveAuthority, 'new refund planning must remain behind fresh booking authority');
  assert.ok(provider > plan, 'provider evidence must remain behind fresh planning');
});

test('documentation preserves exact replay without granting new lifecycle authority', () => {
  assert.match(docs, /Exact idempotent retries must continue to verify and return that evidence/i);
  assert.match(docs, /different reference or a genuinely new settlement attempt still must satisfy the live amendment status/i);
  assert.match(docs, /new refund on a cancelled booking remains rejected/i);
  assert.match(docs, /no new provider call occurs during an idempotent replay/i);
  assert.match(docs, /No schema or migration change is required/i);
  assert.match(docs, /GitHub Actions are not required or used/i);
});
