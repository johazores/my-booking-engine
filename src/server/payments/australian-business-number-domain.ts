export class AustralianBusinessNumberValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AustralianBusinessNumberValidationError';
  }
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

export function normalizeAustralianBusinessNumber(value: unknown) {
  if (typeof value !== 'string') {
    throw new AustralianBusinessNumberValidationError('Australian business number must be a string.');
  }
  const normalized = value.replace(/[\s-]+/g, '');
  if (!/^\d{11}$/.test(normalized)) {
    throw new AustralianBusinessNumberValidationError('Australian business number must contain exactly 11 digits.');
  }

  const digits = [...normalized].map((digit) => Number(digit));
  const first = digits[0];
  if (first === undefined || first < 1) {
    throw new AustralianBusinessNumberValidationError('Australian business number checksum is invalid.');
  }
  digits[0] = first - 1;
  const weightedTotal = digits.reduce((total, digit, index) => total + digit * (ABN_WEIGHTS[index] ?? 0), 0);
  if (weightedTotal % 89 !== 0) {
    throw new AustralianBusinessNumberValidationError('Australian business number checksum is invalid.');
  }
  return normalized;
}

export function isValidAustralianBusinessNumber(value: unknown) {
  try {
    normalizeAustralianBusinessNumber(value);
    return true;
  } catch (error) {
    if (error instanceof AustralianBusinessNumberValidationError) return false;
    throw error;
  }
}
