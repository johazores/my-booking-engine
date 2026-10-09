export type PaymentHistoryPageError = 'page-size' | 'id-order';

export function validatePaymentHistoryPage(
  rows: readonly Readonly<{ id: string }>[],
  previousId: string | undefined,
  pageSize: number,
): PaymentHistoryPageError | null {
  if (rows.length > pageSize) return 'page-size';

  let lastId = previousId;
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id.length === 0 || (lastId !== undefined && row.id <= lastId)) {
      return 'id-order';
    }
    lastId = row.id;
  }
  return null;
}
