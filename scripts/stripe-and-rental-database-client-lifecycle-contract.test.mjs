import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-only guard. Actual database behavior requires Node 24 and disposable PostgreSQL.
const stripeSuites = [
  'stripe-payment.integration.ts',
  'stripe-refund.integration.ts',
  'stripe-refund-webhook.integration.ts',
];
const catalogSuites = [
  'stripe-reference-database-constraints.integration.ts',
  'hospitality-commercial-settlement-evidence-database-integrity.integration.ts',
  'hospitality-v6-refund-authority-database-integrity.integration.ts',
];
const retainedLedgerSuites = [
  'rental-payment.integration.ts',
  'rental-security-bond.integration.ts',
];

function readSuite(filename) {
  return readFileSync(new URL('../src/server/payments/' + filename, import.meta.url), 'utf8');
}

for (const filename of stripeSuites) {
  test(filename + ' releases Prisma after cleanup failure and uses future database-clock stay dates', () => {
    const source = readSuite(filename);
    const registration = source.indexOf('t.after(async () => {');
    const firstWrite = source.search(/const admin(?:A)? = await db\.user\.create/);
    assert.ok(registration >= 0 && firstWrite > registration, 'teardown must precede fixture writes');
    assert.match(source.slice(registration, firstWrite), /try \{[\s\S]*finally \{\s*await db\.\$disconnect\(\);/);
    assert.equal((source.match(/await db\.\$disconnect\(\)/g) ?? []).length, 1);
    assert.match(source, /SELECT clock_timestamp\(\) AS "now"/);
    assert.match(source, /databaseNow\.getUTCDate\(\) \+ 30 \+ offset/);
    assert.match(source, /stayDate\(/);
    assert.doesNotMatch(source, /new Date\((?:'|\x60)2026-/);
    assert.doesNotMatch(source, /2026-(?:09|10)-\x24\{/);
    assert.match(source, /new Date\(databaseNow\.getTime\(\) \+ 3_600_000\)/);
  });
}

for (const filename of catalogSuites) {
  test(filename + ' disconnects after read-only database assertions', () => {
    const source = readSuite(filename);
    assert.match(source, /import test, \{ after \} from 'node:test'/);
    assert.match(source, /after\(async \(\) => \{\s*const \{ db \} = await import\('\.\.\/database\.ts'\);\s*await db\.\$disconnect\(\);\s*\}\)/);
    assert.equal((source.match(/await db\.\$disconnect\(\)/g) ?? []).length, 1);
  });
}

for (const filename of retainedLedgerSuites) {
  test(filename + ' closes Prisma without deleting append-only financial evidence', () => {
    const source = readSuite(filename);
    const registration = source.indexOf('t.after(async () => {');
    const firstWrite = source.search(/const admin = await db\.user\.create/);
    assert.ok(registration >= 0 && firstWrite > registration);
    assert.match(source.slice(registration, firstWrite), /await db\.\$disconnect\(\)/);
    assert.equal((source.match(/await db\.\$disconnect\(\)/g) ?? []).length, 1);
    assert.doesNotMatch(source, /db\.rentalPaymentTransaction\.deleteMany/);
    assert.doesNotMatch(source, /db\.rentalSecurityBondTransaction\.deleteMany/);
  });
}
