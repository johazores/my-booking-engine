import assert from 'node:assert/strict';
import test from 'node:test';
import { DATABASE_TEST_CONFIRMATION, validateDisposableTestDatabase } from './database-test-safety.mjs';

test('numeric IPv4 aliases cannot bypass disposable database separation', () => {
  for (const host of ['0x7f000001', '0177.0.0.1', '2130706433', '0x7f.1', '127.000.000.001', '0', '0.0', '0.0.0', '0x0']) {
    const canonical = host.startsWith('0x0') || host === '0' || host.startsWith('0.') ? '0.0.0.0' : 'localhost';
    for (const reversed of [false, true]) {
      assert.throws(() => validateDisposableTestDatabase({
        testDatabaseUrl: `postgresql://${reversed ? canonical : host}/sf_test`,
        applicationDatabaseUrl: `postgresql://${reversed ? host : canonical}/sf_test`,
        confirmation: DATABASE_TEST_CONFIRMATION,
      }), /different PostgreSQL database/, host);
    }
  }
});

test('numeric aliases of non-loopback servers and local environment URLs are compared', () => {
  assert.throws(() => validateDisposableTestDatabase({
    testDatabaseUrl: 'postgresql://0xc0a80101/sf_test',
    applicationDatabaseUrls: ['postgresql://192.168.1.1/sf_test'],
    confirmation: DATABASE_TEST_CONFIRMATION,
  }), /different PostgreSQL database/);
});

test('IPv4-mapped IPv6 aliases of non-loopback servers cannot bypass target separation', () => {
  const aliases = [
    ['[::ffff:192.168.1.1]', '192.168.1.1'],
    ['[::ffff:c0a8:101]', '0xc0a80101'],
    ['[::ffff:8.8.8.8]', '8.8.8.8'],
    ['[::ffff:ffff:ffff]', '255.255.255.255'],
  ];
  for (const [mapped, ipv4] of aliases) {
    for (const reversed of [false, true]) {
      assert.throws(() => validateDisposableTestDatabase({
        testDatabaseUrl: `postgresql://${reversed ? ipv4 : mapped}/sf_test`,
        applicationDatabaseUrl: `postgresql://${reversed ? mapped : ipv4}/sf_test`,
        confirmation: DATABASE_TEST_CONFIRMATION,
      }), /different PostgreSQL database/, `${mapped} vs ${ipv4}, reversed=${reversed}`);
    }
    assert.throws(() => validateDisposableTestDatabase({
      testDatabaseUrl: `postgresql://${mapped}/sf_test`,
      applicationDatabaseUrls: [`postgresql://${ipv4}/sf_test`],
      confirmation: DATABASE_TEST_CONFIRMATION,
    }), /different PostgreSQL database/, `local application target: ${mapped}`);
  }
});

test('mapped IPv4 normalization preserves distinct destinations and databases', () => {
  for (const applicationDatabaseUrl of [
    'postgresql://192.168.1.2/sf_test',
    'postgresql://192.168.1.1/sf_dev',
    'postgresql://192.168.1.1:5433/sf_test',
  ]) {
    const testDatabaseUrl = 'postgresql://[::ffff:192.168.1.1]/sf_test';
    assert.equal(validateDisposableTestDatabase({
      testDatabaseUrl,
      applicationDatabaseUrl,
      confirmation: DATABASE_TEST_CONFIRMATION,
    }), testDatabaseUrl);
  }
});

test('different database names and ports remain allowed', () => {
  assert.equal(validateDisposableTestDatabase({
    testDatabaseUrl: 'postgresql://0x7f000001/sf_test',
    applicationDatabaseUrl: 'postgresql://localhost/sf_dev',
    confirmation: DATABASE_TEST_CONFIRMATION,
  }), 'postgresql://0x7f000001/sf_test');
});

test('retains conservative rejection of bare 127 host alias', () => {
  assert.throws(() => validateDisposableTestDatabase({
    testDatabaseUrl: 'postgresql://127/sf_test',
    applicationDatabaseUrl: 'postgresql://localhost/sf_test',
    confirmation: DATABASE_TEST_CONFIRMATION,
  }), /different PostgreSQL database/);
});
