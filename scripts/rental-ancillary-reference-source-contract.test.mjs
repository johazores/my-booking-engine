import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const name of ['rental-damage-settlement', 'rental-late-return-settlement', 'rental-security-bond']) {
  test(name + ' checks retained manual identity and chronology', () => {
    const source = readFileSync('src/server/payments/' + name + '-domain.ts', 'utf8');
    assert.match(source, /isCanonicalManualPaymentReference\(row\.providerReference\)/);
    assert.match(source, /isCanonicalManualPaymentReference\(row\.sourceProviderReference\)/);
    assert.match(source, /Number\.isFinite\(row\.createdAt\.getTime\(\)\)/);
  });
}
