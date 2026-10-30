import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthCryptoCapacityError, createAuthCryptoLimiter } from './auth-crypto-capacity.ts';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test('scrypt limiter bounds parallel work and admits queued requests in order', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 2, maxQueued: 2, queueTimeoutMs: 1000 });
  const first = deferred();
  const second = deferred();
  const order: number[] = [];
  let active = 0;
  let maximum = 0;
  const job = (id: number, wait?: Promise<void>) => run(async () => {
    order.push(id);
    active += 1;
    maximum = Math.max(maximum, active);
    try { await wait; return id; } finally { active -= 1; }
  });
  const a = job(1, first.promise);
  const b = job(2, second.promise);
  await Promise.resolve();
  const c = job(3);
  const d = job(4);
  const rejected = job(5);
  await assert.rejects(rejected, AuthCryptoCapacityError);
  assert.deepEqual(order, [1, 2]);
  first.release();
  assert.equal(await a, 1);
  assert.equal(await c, 3);
  second.release();
  assert.equal(await b, 2);
  assert.equal(await d, 4);
  assert.deepEqual(order, [1, 2, 3, 4]);
  assert.equal(maximum, 2);
  assert.equal(await job(6), 6);
});

test('scrypt limiter frees slots when work rejects', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 100 });
  await assert.rejects(() => run(async () => { throw new Error('scrypt failed'); }), /scrypt failed/);
  assert.equal(await run(async () => 'recovered'), 'recovered');
});

test('queued scrypt work times out without running later or leaking capacity', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 20 });
  const blocker = deferred();
  const first = run(async () => { await blocker.promise; return 'first'; });
  let ran = false;
  await assert.rejects(() => run(async () => { ran = true; }), AuthCryptoCapacityError);
  assert.equal(ran, false);
  blocker.release();
  assert.equal(await first, 'first');
  assert.equal(await run(async () => 'next'), 'next');
});

test('invalid capacity settings fail before accepting work', () => {
  for (const options of [
    { maxActive: 0, maxQueued: 1, queueTimeoutMs: 10 },
    { maxActive: 1, maxQueued: -1, queueTimeoutMs: 10 },
    { maxActive: 1, maxQueued: 1, queueTimeoutMs: 0 },
    { maxActive: 1.5, maxQueued: 1, queueTimeoutMs: 10 },
  ]) assert.throws(() => createAuthCryptoLimiter(options), RangeError);
});
