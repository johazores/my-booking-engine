import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from '../pricing/money.ts';

export type RentalDamageCaseStatus = 'OPEN' | 'ASSESSED' | 'WAIVED' | 'CLOSED';

export type RentalDamageCaseCreateInput = Readonly<{
  summary: string;
}>;

export type RentalDamageCaseAssessmentInput = Readonly<{
  estimatedRepairCostMajor: string;
  notes: string;
}>;

export type RentalDamageCaseWaiverInput = Readonly<{
  reason: string;
}>;

export type RentalDamageCaseClosureInput = Readonly<{
  notes: string;
}>;

function normalizeRequiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new RentalInventoryValidationError(`${field} is required.`);
  if (normalized.length > maxLength) throw new RentalInventoryValidationError(`${field} is too long.`);
  return normalized;
}

export function normalizeRentalDamageCaseCreateInput(input: RentalDamageCaseCreateInput) {
  return Object.freeze({
    summary: normalizeRequiredText(input.summary, 'Damage case summary', 1000),
  });
}

export function normalizeRentalDamageCaseAssessmentInput(
  input: RentalDamageCaseAssessmentInput,
  currency: string,
) {
  const notes = normalizeRequiredText(input.notes, 'Damage assessment notes', 2000);
  try {
    const money = parseMoneyMajorToMinor(input.estimatedRepairCostMajor, currency);
    return Object.freeze({
      estimatedRepairCostMinor: money.amountMinor,
      currency: money.currency,
      notes,
    });
  } catch (error) {
    if (error instanceof PricingValidationError) {
      throw new RentalInventoryValidationError(`Estimated repair cost is invalid: ${error.message}`);
    }
    throw error;
  }
}

export function normalizeRentalDamageCaseWaiverInput(input: RentalDamageCaseWaiverInput) {
  return Object.freeze({
    reason: normalizeRequiredText(input.reason, 'Damage case waiver reason', 1000),
  });
}

export function normalizeRentalDamageCaseClosureInput(input: RentalDamageCaseClosureInput) {
  return Object.freeze({
    notes: normalizeRequiredText(input.notes, 'Damage case resolution notes', 2000),
  });
}

export function assertRentalDamageCaseTransition(
  current: RentalDamageCaseStatus,
  target: Exclude<RentalDamageCaseStatus, 'OPEN'>,
) {
  const allowed =
    (current === 'OPEN' && (target === 'ASSESSED' || target === 'WAIVED'))
    || (current === 'ASSESSED' && (target === 'WAIVED' || target === 'CLOSED'));
  if (!allowed) {
    throw new RentalInventoryValidationError(
      `Rental damage case cannot transition from ${current} to ${target}.`,
    );
  }
}

export function rentalDamageCaseOperationalReason() {
  return 'Return damage case pending resolution';
}
