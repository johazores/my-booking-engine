import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthCryptoCapacityError, createAuthCryptoLimiter } from './auth-crypto-capacity.ts';
import { AuthRequestAbortedError } from './auth-request-abort.ts';

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

test('pre-aborted requests never occupy a worker or execute crypto', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 100 });
  const controller = new AbortController();
  controller.abort();
  let ran = false;
  await assert.rejects(() => run(async () => { ran = true; }, controller.signal), AuthRequestAbortedError);
  assert.equal(ran, false);
  assert.equal(await run(async () => 'next'), 'next');
});

test('aborted middle waiter is removed without displacing FIFO neighbors', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 1, maxQueued: 2, queueTimeoutMs: 1000 });
  const blocker = deferred();
  const order: number[] = [];
  const first = run(async () => { order.push(1); await blocker.promise; });
  const aborted = new AbortController();
  let abortedRan = false;
  const second = run(async () => { abortedRan = true; }, aborted.signal);
  const third = run(async () => { order.push(3); });
  aborted.abort();
  await assert.rejects(second, AuthRequestAbortedError);
  const fourth = run(async () => { order.push(4); });
  blocker.release();
  await Promise.all([first, third, fourth]);
  assert.equal(abortedRan, false);
  assert.deepEqual(order, [1, 3, 4]);
  assert.equal(await run(async () => 'recovered'), 'recovered');
});

test('aborting a running derivation waits for completion then rejects and releases the slot', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 1000 });
  const blocker = deferred();
  const controller = new AbortController();
  const first = run(async () => { await blocker.promise; return 'secret'; }, controller.signal);
  let nextRan = false;
  const next = run(async () => { nextRan = true; return 'next'; });
  controller.abort();
  assert.equal(nextRan, false);
  blocker.release();
  await assert.rejects(first, AuthRequestAbortedError);
  assert.equal(await next, 'next');
  assert.equal(nextRan, true);
});

test('aborted waiter can never execute after the active worker finishes', async () => {
  const run = createAuthCryptoLimiter({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 1000 });
  const blocker = deferred();
  const first = run(async () => blocker.promise);
  const controller = new AbortController();
  let ran = false;
  const waiting = run(async () => { ran = true; }, controller.signal);
  controller.abort();
  await assert.rejects(waiting, AuthRequestAbortedError);
  blocker.release();
  await first;
  assert.equal(ran, false);
  assert.equal(await run(async () => 'okay'), 'okay');
});
