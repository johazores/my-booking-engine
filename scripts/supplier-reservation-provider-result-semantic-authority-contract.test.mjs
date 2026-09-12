import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/server/suppliers/hospitality-supplier-reservation-provider-result-authority.ts', import.meta.url),
  'utf8',
);
const documentation = await readFile(
  new URL('../docs/supplier-reservation-provider-result-authority.md', import.meta.url),
  'utf8',
);

test('provider-result authority validates canonical commercial identity and money before freezing', () => {
  assert.match(source, /MAX_REFERENCE_LENGTH = 4_096/);
  assert.match(source, /FINGERPRINT_PATTERN = \/\^\[0-9a-f\]\{64\}\$\//);
  assert.match(source, /CURRENCY_PATTERN = \/\^\[A-Z\]\{3\}\$\//);
  assert.match(source, /MAX_TOTAL_MINOR = 9_000_000_000_000_000n/);
  assert.match(source, /isExactHospitalitySupplierMachineToken/);
  assert.match(source, /nonNegativeMinor\(totalMinor\)/);
  assert.match(source, /authorityFingerprint === null \? null : fingerprint\(authorityFingerprint\)/);
  assert.match(source, /providerSubmissionReference === null[\s\S]*machineToken\(providerSubmissionReference\)/);
});

test('provider-result authority rejects forged list members and malformed deposit dates', () => {
  assert.match(source, /allowedGuaranteeTypes = new Set<HospitalitySupplierRuleGuaranteeType>/);
  assert.match(source, /if \(seen\.has\(normalized\)\) invalidResult\(\)/);
  assert.match(source, /MAX_PAYMENT_CARD_CODE_LENGTH = 16/);
  assert.match(source, /machineToken\(item, MAX_PAYMENT_CARD_CODE_LENGTH\)/);
  assert.match(source, /nullableLocalDate\(dueDateLocal\)/);
  assert.match(source, /parsed\.toISOString\(\)\.slice\(0, 10\) !== value/);
});

test('documentation records semantic validation without weakening activation gates', () => {
  assert.match(documentation, /canonical machine-token supplier references/);
  assert.match(documentation, /64-character lowercase-hex .*fingerprints/);
  assert.match(documentation, /three-letter uppercase currency/);
  assert.match(documentation, /guarantee types .*without duplicates/);
  assert.match(documentation, /accepted-card codes as unique exact machine tokens/);
  assert.match(documentation, /Travelport `reservation` remains deliberately disabled/);
  assert.match(documentation, /GitHub Actions are not used/);
});
