export function safeObservationClockMs(nowMs: () => number): number | null {
  try {
    const value = nowMs();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function safeObservationDurationMs(startedAt: number | null, nowMs: () => number): number {
  const finishedAt = safeObservationClockMs(nowMs);
  if (startedAt === null || finishedAt === null) return 0;
  const elapsedMs = finishedAt - startedAt;
  return Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0;
}

export function safeObservationTimestamp(now: () => Date): string {
  try {
    return now().toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export function emitStructuredObservationSafely<T>(sink: (record: T) => void, record: T): void {
  try {
    sink(record);
  } catch {
    // Observability availability must never become application or provider-request authority.
  }
}
