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
  admit: () => void;
}

/** A slot is transferred directly to the oldest waiter, never briefly made public. */
export function createAuthCryptoLimiter(options: Readonly<AuthCryptoCapacityOptions>) {
  const { maxActive, maxQueued, queueTimeoutMs } = options;
  if (![maxActive, maxQueued, queueTimeoutMs].every(Number.isSafeInteger) ||
      maxActive < 1 || maxQueued < 0 || queueTimeoutMs < 1) {
    throw new RangeError('Invalid authentication cryptographic capacity limits.');
  }

  let active = 0;
  const waiting: WaitingRequest[] = [];

  async function acquire() {
    if (active < maxActive && waiting.length === 0) {
      active += 1;
      return;
    }
    if (waiting.length >= maxQueued) throw new AuthCryptoCapacityError();

    await new Promise<void>((resolve, reject) => {
      const waiter: WaitingRequest = {
        admit: () => {
          clearTimeout(timeout);
          resolve();
        },
      };
      const timeout = setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index === -1) return;
        waiting.splice(index, 1);
        reject(new AuthCryptoCapacityError());
      }, queueTimeoutMs);
      waiting.push(waiter);
    });
  }

  function release() {
    const next = waiting.shift();
    if (next) next.admit();
    else active -= 1;
  }

  return async function runWithCapacity<T>(work: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await work();
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
