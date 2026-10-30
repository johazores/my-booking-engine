/** Aborted credential requests must not keep queued crypto work or start new session writes. */
export class AuthRequestAbortedError extends Error {
  constructor() {
    super('Authentication request was aborted.');
    this.name = 'AuthRequestAbortedError';
  }
}

export function assertAuthRequestNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new AuthRequestAbortedError();
}
