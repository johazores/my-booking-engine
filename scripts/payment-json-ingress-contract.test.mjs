import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const ROUTES = [
  'app/api/payments/manual/route.ts',
  'app/api/payments/manual/refunds/route.ts',
  'app/api/payments/stripe/refunds/route.ts',
  'app/api/payments/stripe/reconcile/route.ts',
  'app/api/payments/stripe/refunds/reconcile/route.ts',
];

const sources = await Promise.all(ROUTES.map(async (path) => [path, await read(path)]));

test('generic payment writes authenticate before bounded JSON parsing', () => {
  for (const [path, source] of sources) {
    const authIndex = source.indexOf('requirePaymentApiContext(request, { write: true })');
    const parseIndex = source.indexOf('readPaymentJsonObject(request)');
    assert.ok(authIndex >= 0, `${path} must require authenticated write context`);
    assert.ok(parseIndex > authIndex, `${path} must parse the body only after write authentication`);
    assert.doesNotMatch(source, /request\.json\(\)/);
  }
});

test('generic payment routes derive tenant and actor authority from authenticated context', () => {
  for (const [path, source] of sources) {
    assert.match(source, /organizationId:\s*context\.organizationId/, `${path} must use server-derived tenant scope`);
    assert.match(source, /actorUserId:\s*context\.actorUserId/, `${path} must use server-derived actor identity`);
    assert.match(source, /paymentApiError\(error\)/, `${path} must normalize payment errors`);
  }
});
