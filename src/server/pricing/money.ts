export class PricingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingValidationError';
  }
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MONEY_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_MONEY_MINOR = 9_000_000_000_000_000n;

export function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new PricingValidationError('Currency must use a three-letter ISO code.');
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency }).format(0);
  } catch {
    throw new PricingValidationError('Currency must be supported by the runtime currency data.');
  }
  return currency;
}

export function currencyMinorUnitDigits(currencyInput: string) {
  const currency = normalizeCurrency(currencyInput);
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
}

export function parseMoneyMajorToMinor(value: string, currencyInput: string) {
  const currency = normalizeCurrency(currencyInput);
  const normalized = value.trim();
  if (!MONEY_PATTERN.test(normalized)) throw new PricingValidationError('Amount must be a non-negative decimal number without separators.');
  const digits = currencyMinorUnitDigits(currency);
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > digits) throw new PricingValidationError(`Amount cannot use more than ${digits} decimal places for ${currency}.`);
  const paddedFraction = digits === 0 ? '' : fraction.padEnd(digits, '0');
  const scale = 10n ** BigInt(digits);
  const amountMinor = (BigInt(whole) * scale) + BigInt(paddedFraction || '0');
  if (amountMinor > MAX_MONEY_MINOR) throw new PricingValidationError('Amount exceeds the supported money range.');
  return { amountMinor, currency };
}

export function moneyMinorToMajorString(amountMinor: bigint, currencyInput: string) {
  const currency = normalizeCurrency(currencyInput);
  if (amountMinor < 0n || amountMinor > MAX_MONEY_MINOR) throw new PricingValidationError('Minor-unit amount is outside the supported money range.');
  const digits = currencyMinorUnitDigits(currency);
  if (digits === 0) return amountMinor.toString();
  const scale = 10n ** BigInt(digits);
  const whole = amountMinor / scale;
  const fraction = (amountMinor % scale).toString().padStart(digits, '0');
  return `${whole}.${fraction}`;
}

export function multiplyMoneyMinor(amountMinor: bigint, quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new PricingValidationError('Money quantity must be a non-negative integer.');
  const result = amountMinor * BigInt(quantity);
  if (result > MAX_MONEY_MINOR) throw new PricingValidationError('Calculated amount exceeds the supported money range.');
  return result;
}

export function addMoneyMinor(values: readonly bigint[]) {
  let total = 0n;
  for (const value of values) {
    if (value < 0n) throw new PricingValidationError('Money components cannot be negative.');
    total += value;
    if (total > MAX_MONEY_MINOR) throw new PricingValidationError('Calculated amount exceeds the supported money range.');
  }
  return total;
}
