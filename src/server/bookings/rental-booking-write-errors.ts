export type RentalBookingWriteErrorDisposition = 'RETRYABLE' | 'CONFLICT' | 'UNKNOWN';

function prismaErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

export function classifyRentalBookingWriteError(
  error: unknown,
  options: Readonly<{ retryUniqueConflict?: boolean }> = {},
): RentalBookingWriteErrorDisposition {
  const code = prismaErrorCode(error);
  if (code === 'P2034') return 'RETRYABLE';
  if (code === 'P2002') return options.retryUniqueConflict ? 'RETRYABLE' : 'CONFLICT';
  if (code === 'P2003' || code === 'P2004') return 'CONFLICT';
  return 'UNKNOWN';
}
