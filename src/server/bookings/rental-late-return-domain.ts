import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import { rentalLocalDateKey } from '../inventory/rental-custody-availability.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from '../pricing/money.ts';

export type RentalLateReturnAssessmentOutcome = 'FEE_ASSESSED' | 'WAIVED';

export type RentalLateReturnAssessmentInput = Readonly<{
  outcome: string;
  graceDays: string;
  feeAmountMajor: string;
  reason: string;
}>;

export type RentalLateReturnPolicyAuthority = Readonly<{
  id: string;
  currency: string;
  graceDays: number;
  dailyFeeMinor: bigint;
}>;

const MAX_GRACE_DAYS = 30;
const MAX_MONEY_MINOR = 9_000_000_000_000_000n;
const MILLIS_PER_DAY = 86_400_000;

function normalizeRequiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new RentalInventoryValidationError(`${field} is required.`);
  if (normalized.length > maxLength) throw new RentalInventoryValidationError(`${field} is too long.`);
  return normalized;
}

function normalizeOutcome(value: string): RentalLateReturnAssessmentOutcome {
  const normalized = value.trim().toUpperCase();
  if (normalized !== 'FEE_ASSESSED' && normalized !== 'WAIVED') {
    throw new RentalInventoryValidationError('Late-return assessment outcome is invalid.');
  }
  return normalized;
}

function normalizeGraceDays(value: string) {
  if (!/^\d+$/.test(value.trim())) {
    throw new RentalInventoryValidationError('Late-return grace days must be a whole number.');
  }
  const graceDays = Number(value.trim());
  if (!Number.isSafeInteger(graceDays) || graceDays < 0 || graceDays > MAX_GRACE_DAYS) {
    throw new RentalInventoryValidationError(`Late-return grace days must be between 0 and ${MAX_GRACE_DAYS}.`);
  }
  return graceDays;
}

function dateKeyToUtcMillis(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RentalInventoryValidationError('Late-return date evidence is invalid.');
  }
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(millis)) throw new RentalInventoryValidationError('Late-return date evidence is invalid.');
  return millis;
}

function committedEndDateKey(endsOn: Date) {
  if (!(endsOn instanceof Date) || Number.isNaN(endsOn.getTime())) {
    throw new RentalInventoryValidationError('Committed rental end evidence is invalid.');
  }
  return endsOn.toISOString().slice(0, 10);
}

export function deriveRentalLateReturnTiming(input: Readonly<{
  returnedAt: Date;
  committedEndsOn: Date;
  timeZone: string;
  graceDays: number;
}>) {
  if (!Number.isSafeInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > MAX_GRACE_DAYS) {
    throw new RentalInventoryValidationError(`Late-return grace days must be between 0 and ${MAX_GRACE_DAYS}.`);
  }
  const returnedLocalDate = rentalLocalDateKey(input.returnedAt, input.timeZone);
  const endDate = committedEndDateKey(input.committedEndsOn);
  const differenceDays = Math.trunc((dateKeyToUtcMillis(returnedLocalDate) - dateKeyToUtcMillis(endDate)) / MILLIS_PER_DAY);
  const lateDays = differenceDays >= 0 ? differenceDays + 1 : 0;
  const chargeableDays = Math.max(0, lateDays - input.graceDays);
  return Object.freeze({ returnedLocalDate, lateDays, chargeableDays });
}

export function normalizeRentalLateReturnAssessmentInput(
  input: RentalLateReturnAssessmentInput,
  source: Readonly<{
    currency: string;
    returnedAt: Date;
    committedEndsOn: Date;
    timeZone: string;
    policy?: RentalLateReturnPolicyAuthority | null;
  }>,
) {
  const outcome = normalizeOutcome(input.outcome);
  const reason = normalizeRequiredText(input.reason, 'Late-return assessment reason', 2000);
  const policy = source.policy ?? null;

  if (policy) {
    if (
      policy.currency !== source.currency
      || !Number.isSafeInteger(policy.graceDays)
      || policy.graceDays < 0
      || policy.graceDays > MAX_GRACE_DAYS
      || policy.dailyFeeMinor <= 0n
      || policy.dailyFeeMinor > MAX_MONEY_MINOR
    ) {
      throw new RentalInventoryValidationError('Retained late-return policy authority is invalid.');
    }
    if (input.graceDays.trim() || input.feeAmountMajor.trim()) {
      throw new RentalInventoryValidationError('Late-return policy-controlled grace and fee values cannot be overridden.');
    }

    const timing = deriveRentalLateReturnTiming({
      returnedAt: source.returnedAt,
      committedEndsOn: source.committedEndsOn,
      timeZone: source.timeZone,
      graceDays: policy.graceDays,
    });
    if (timing.lateDays === 0) {
      throw new RentalInventoryValidationError('A late-return assessment requires return evidence after the committed rental period.');
    }

    if (outcome === 'FEE_ASSESSED' && timing.chargeableDays === 0) {
      throw new RentalInventoryValidationError('The retained return is inside the active late-return policy grace period.');
    }

    const policyFeeMinor = policy.dailyFeeMinor * BigInt(timing.chargeableDays);
    if (outcome === 'FEE_ASSESSED' && policyFeeMinor > MAX_MONEY_MINOR) {
      throw new RentalInventoryValidationError('Calculated late-return policy fee exceeds the supported money range.');
    }

    return Object.freeze({
      outcome,
      graceDays: policy.graceDays,
      lateDays: timing.lateDays,
      chargeableDays: timing.chargeableDays,
      currency: source.currency,
      feeMinor: outcome === 'FEE_ASSESSED' ? policyFeeMinor : null,
      policyRevisionId: policy.id,
      policyDailyFeeMinor: policy.dailyFeeMinor,
      reason,
    });
  }

  const graceDays = normalizeGraceDays(input.graceDays);
  const timing = deriveRentalLateReturnTiming({
    returnedAt: source.returnedAt,
    committedEndsOn: source.committedEndsOn,
    timeZone: source.timeZone,
    graceDays,
  });
  if (timing.lateDays === 0) {
    throw new RentalInventoryValidationError('A late-return assessment requires return evidence after the committed rental period.');
  }

  const amountInput = input.feeAmountMajor.trim();
  if (outcome === 'WAIVED') {
    if (amountInput) {
      throw new RentalInventoryValidationError('Late-return fee amount must be blank when the fee is waived.');
    }
    return Object.freeze({
      outcome,
      graceDays,
      lateDays: timing.lateDays,
      chargeableDays: timing.chargeableDays,
      currency: source.currency,
      feeMinor: null,
      policyRevisionId: null,
      policyDailyFeeMinor: null,
      reason,
    });
  }

  if (timing.chargeableDays === 0) {
    throw new RentalInventoryValidationError('A late-return fee cannot be assessed while the retained return remains inside the selected grace period.');
  }

  let feeMinor: bigint;
  try {
    feeMinor = parseMoneyMajorToMinor(amountInput, source.currency).amountMinor;
  } catch (error) {
    if (error instanceof PricingValidationError) {
      throw new RentalInventoryValidationError(`Late-return fee amount is invalid: ${error.message}`);
    }
    throw error;
  }
  if (feeMinor <= 0n) {
    throw new RentalInventoryValidationError('Late-return fee amount must be greater than zero.');
  }

  return Object.freeze({
    outcome,
    graceDays,
    lateDays: timing.lateDays,
    chargeableDays: timing.chargeableDays,
    currency: source.currency,
    feeMinor,
    policyRevisionId: null,
    policyDailyFeeMinor: null,
    reason,
  });
}
