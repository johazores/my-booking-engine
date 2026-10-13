import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const [name, builder] of [
  ['rental-damage-settlement', 'buildRentalDamageSettlementIdempotencyKey'],
  ['rental-late-return-settlement', 'buildRentalLateReturnSettlementIdempotencyKey'],
]) {
  test(name + ' independently validates retained manual identity before fingerprint', () => {
    const service = readFileSync('src/server/payments/' + name + '-service.ts', 'utf8');
    assert.match(service, /isCanonicalManualPaymentReference\(row\.providerReference\)/);
    assert.match(service, /isCanonicalManualPaymentReference\(row\.sourceProviderReference\)/);
    assert.match(service, /row\.sourceProviderReference === row\.providerReference/);
    assert.match(service, /row\.createdAt instanceof Date/);
    assert.ok(service.includes('row.idempotencyKey !== ' + builder + '('));
    assert.match(service, /row\.requestFingerprint !== fingerprint/);
  });
}

test('bond financial and operational readers share retained identity validation', () => {
  const domain = readFileSync('src/server/payments/rental-security-bond-domain.ts', 'utf8');
  const service = readFileSync('src/server/payments/rental-security-bond-service.ts', 'utf8');
  const guard = readFileSync('src/server/bookings/rental-booking-security-bond-guard-service.ts', 'utf8');
  for (const source of [service, guard]) {
    assert.match(source, /isValidRentalSecurityBondRetainedTransaction\(/);
  }
  assert.match(domain, /isCanonicalManualPaymentReference\(row\.providerReference\)/);
  assert.match(domain, /row\.idempotencyKey !== buildRentalSecurityBondTransactionIdempotencyKey/);
  assert.match(guard, /forfeiture\.collectionTransactionId !== collection\.id/);
});
