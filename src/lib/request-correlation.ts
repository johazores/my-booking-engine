export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function isSafeRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function appendRequestReference(message: string, response: Response) {
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  return isSafeRequestId(requestId) ? `${message} Request reference: ${requestId}` : message;
}
