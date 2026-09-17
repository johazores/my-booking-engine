import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from '../pricing/money.ts';

export type RentalDamageLiabilityOutcome = 'CUSTOMER_LIABLE' | 'NO_CUSTOMER_LIABILITY';

export type RentalDamageLiabilityDecisionInput = Readonly<{
  outcome: string;
  liableAmountMajor: string;
  reason: string;
}>;

function normalizeRequiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new RentalInventoryValidationError(`${field} is required.`);
  if (normalized.length > maxLength) throw new RentalInventoryValidationError(`${field} is too long.`);
  return normalized;
}

function normalizeOutcome(value: string): RentalDamageLiabilityOutcome {
  const outcome = value.trim().toUpperCase();
  if (outcome !== 'CUSTOMER_LIABLE' && outcome !== 'NO_CUSTOMER_LIABILITY') {
    throw new RentalInventoryValidationError('Damage liability outcome is invalid.');
  }
  return outcome;
}

export function normalizeRentalDamageLiabilityDecisionInput(
  input: RentalDamageLiabilityDecisionInput,
  currency: string,
  estimatedRepairCostMinor: bigint,
) {
  if (estimatedRepairCostMinor < 0n) {
    throw new RentalInventoryValidationError('Retained damage repair estimate is invalid.');
  }

  const outcome = normalizeOutcome(input.outcome);
  const reason = normalizeRequiredText(input.reason, 'Damage liability reason', 2000);
  const amountInput = input.liableAmountMajor.trim();

  if (outcome === 'NO_CUSTOMER_LIABILITY') {
    if (amountInput) {
      throw new RentalInventoryValidationError(
        'Customer liability amount must be blank when no customer liability is recorded.',
      );
    }
    return Object.freeze({
      outcome,
      currency,
      liableAmountMinor: null,
      reason,
    });
  }

  let liableAmountMinor: bigint;
  try {
    liableAmountMinor = parseMoneyMajorToMinor(amountInput, currency).amountMinor;
  } catch (error) {
    if (error instanceof PricingValidationError) {
      throw new RentalInventoryValidationError(`Customer liability amount is invalid: ${error.message}`);
    }
    throw error;
  }

  if (liableAmountMinor <= 0n) {
    throw new RentalInventoryValidationError('Customer liability amount must be greater than zero.');
  }
  if (liableAmountMinor > estimatedRepairCostMinor) {
    throw new RentalInventoryValidationError(
      'Customer liability amount cannot exceed the retained repair-cost estimate.',
    );
  }

  return Object.freeze({
    outcome,
    currency,
    liableAmountMinor,
    reason,
  });
}
