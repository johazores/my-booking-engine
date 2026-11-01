import { AuthRequestAbortedError, assertAuthRequestNotAborted } from './auth-request-abort.ts';

/** Bound memory-intensive scrypt work independently of HTTP rate limits. */
export class AuthCryptoCapacityError extends Error {
  constructor() {
    super('Authentication cryptographic capacity is temporarily exhausted.');
    this.name = 'AuthCryptoCapacityError';
  }
}

interface AuthCryptoCapacityOptions {
  maxActive: number;
  maxQueued: number;
  queueTimeoutMs: number;
}

interface WaitingRequest {
  /** A delayed timer must not allow an expired waiter to inherit a released slot. */
  admit: () => boolean;
  expireIfOverdue: () => boolean;
}

/** A slot is transferred directly to the oldest eligible waiter, never briefly made public. */
export function createAuthCryptoLimiter(
  options: Readonly<AuthCryptoCapacityOptions>,
  nowMs: () => number = () => performance.now(),
) {
  const { maxActive, maxQueued, queueTimeoutMs } = options;
  if (![maxActive, maxQueued, queueTimeoutMs].every(Number.isSafeInteger) ||
      maxActive < 1 || maxQueued < 0 || queueTimeoutMs < 1) {
    throw new RangeError('Invalid authentication cryptographic capacity limits.');
  }

  let active = 0;
  const waiting: WaitingRequest[] = [];

  async function acquire(signal?: AbortSignal) {
    assertAuthRequestNotAborted(signal);
    // Delayed timer callbacks must not let expired waiters occupy a full queue.
    for (let index = waiting.length - 1; index >= 0; index -= 1) {
      if (waiting[index].expireIfOverdue()) waiting.splice(index, 1);
    }
    if (active < maxActive && waiting.length === 0) {
      active += 1;
      return;
    }
    if (waiting.length >= maxQueued) throw new AuthCryptoCapacityError();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const deadline = nowMs() + queueTimeoutMs;
      const removeWaiter = () => {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        removeWaiter();
        reject(new AuthRequestAbortedError());
      };
      const expireIfOverdue = () => {
        if (settled || nowMs() < deadline) return false;
        settled = true;
        cleanup();
        reject(new AuthCryptoCapacityError());
        return true;
      };
      const waiter: WaitingRequest = {
        expireIfOverdue,
        admit: () => {
          if (settled || expireIfOverdue()) return false;
          settled = true;
          cleanup();
          resolve();
          return true;
        },
      };
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        removeWaiter();
        reject(new AuthCryptoCapacityError());
      }, queueTimeoutMs);
      waiting.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      // Covers an abort between the initial check and listener registration.
      if (signal?.aborted) onAbort();
    });
  }

  function release() {
    while (waiting.length > 0) {
      const next = waiting.shift()!;
      if (next.admit()) return;
    }
    active -= 1;
  }

  return async function runWithCapacity<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal);
    try {
      assertAuthRequestNotAborted(signal);
      const result = await work();
      // Scrypt itself is not cancellable; do not use its result after a disconnect.
      assertAuthRequestNotAborted(signal);
      return result;
    } finally {
      release();
    }
  };
}

/** Each scrypt call uses roughly 64 MiB; never enqueue unbounded crypto work. */
export const runWithAuthCryptoCapacity = createAuthCryptoLimiter({
  maxActive: 2,
  maxQueued: 16,
  queueTimeoutMs: 10_000,
});
