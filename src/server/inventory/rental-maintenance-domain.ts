import { RentalInventoryValidationError } from './rental-domain.ts';

export type RentalMaintenanceCreateInput = Readonly<{
  idempotencyKey: string;
  title: string;
  description?: string;
}>;

export type RentalMaintenanceTransitionInput = Readonly<{
  status: string;
  completionNotes?: string;
  cancellationReason?: string;
}>;

export type RentalMaintenanceStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type RentalMaintenanceTransitionStatus = Exclude<RentalMaintenanceStatus, 'OPEN'>;

function requiredText(value: string | undefined, label: string, maxLength: number) {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) throw new RentalInventoryValidationError(`${label} is required.`);
  if (normalized.length > maxLength) {
    throw new RentalInventoryValidationError(`${label} is too long.`);
  }
  return normalized;
}

function optionalText(value: string | undefined, label: string, maxLength: number) {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new RentalInventoryValidationError(`${label} is too long.`);
  }
  return normalized;
}

export function normalizeRentalMaintenanceIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(normalized)) {
    throw new RentalInventoryValidationError(
      'Maintenance idempotency key must use 1-120 letters, numbers, colons, underscores, or hyphens.',
    );
  }
  return normalized;
}

export function normalizeRentalMaintenanceCreateInput(input: RentalMaintenanceCreateInput) {
  return Object.freeze({
    idempotencyKey: normalizeRentalMaintenanceIdempotencyKey(input.idempotencyKey),
    title: requiredText(input.title, 'Maintenance title', 160),
    description: optionalText(input.description, 'Maintenance description', 2000),
  });
}

export function normalizeRentalMaintenanceTransitionInput(
  input: RentalMaintenanceTransitionInput,
) {
  const status = input.status.trim().toUpperCase();
  if (status !== 'IN_PROGRESS' && status !== 'COMPLETED' && status !== 'CANCELLED') {
    throw new RentalInventoryValidationError('Maintenance transition status is invalid.');
  }

  const completionNotes = optionalText(input.completionNotes, 'Completion notes', 2000);
  const cancellationReason = optionalText(input.cancellationReason, 'Cancellation reason', 500);

  if (status === 'CANCELLED' && !cancellationReason) {
    throw new RentalInventoryValidationError('Cancellation reason is required.');
  }
  if (status !== 'CANCELLED' && cancellationReason) {
    throw new RentalInventoryValidationError('Cancellation reason is only valid when cancelling work.');
  }
  if (status !== 'COMPLETED' && completionNotes) {
    throw new RentalInventoryValidationError('Completion notes are only valid when completing work.');
  }

  return Object.freeze({
    status: status as RentalMaintenanceTransitionStatus,
    completionNotes: status === 'COMPLETED' ? completionNotes : null,
    cancellationReason: status === 'CANCELLED' ? cancellationReason : null,
  });
}

export function assertRentalMaintenanceTransition(
  currentStatus: RentalMaintenanceStatus,
  targetStatus: RentalMaintenanceTransitionStatus,
) {
  if (currentStatus === 'COMPLETED' || currentStatus === 'CANCELLED') {
    throw new RentalInventoryValidationError('Completed or cancelled maintenance work cannot be reopened.');
  }
  if (currentStatus === 'IN_PROGRESS' && targetStatus === 'IN_PROGRESS') return;
  if (currentStatus === 'OPEN') return;
  if (currentStatus === 'IN_PROGRESS' && (targetStatus === 'COMPLETED' || targetStatus === 'CANCELLED')) return;
  throw new RentalInventoryValidationError('Maintenance work order transition is invalid.');
}

export function rentalMaintenanceOperationalReason(title: string) {
  return `Maintenance: ${title}`;
}
