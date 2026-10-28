// Test-only date windows. Anchor future rental scenarios to PostgreSQL time,
// not the developer machine clock or a fixed calendar year.
const DAY_MS = 86_400_000;

export function rentalIntegrationDateAtOffset(databaseNow: Date, daysAhead: number): string {
  if (!(databaseNow instanceof Date) || !Number.isFinite(databaseNow.getTime()) ||
      !Number.isSafeInteger(daysAhead) || daysAhead < 0) {
    throw new Error('Invalid rental integration test date offset');
  }
  const target = new Date(databaseNow.getTime() + daysAhead * DAY_MS);
  if (!Number.isFinite(target.getTime())) {
    throw new Error('Rental integration test date is out of range');
  }
  return target.toISOString().slice(0, 10);
}
