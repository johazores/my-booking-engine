import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { TravelportStaysSensitiveReservationPaymentCard } from './travelport-stays-reservation-create-executor.ts';

export type TravelportStaysReservationPaymentCardPurpose =
  | 'INITIAL_CREATE'
  | 'REVIEW_ACCEPTANCE_CREATE';

export type TravelportStaysReservationPaymentCardSourceContext = Readonly<{
  organizationId: string;
  reservationId: string;
  integrationId: string;
  integrationCredentialVersion: number;
  attemptId: string;
  purpose: TravelportStaysReservationPaymentCardPurpose;
}>;

/**
 * Server-only capability for obtaining one ephemeral Travelport form of payment.
 *
 * Implementations must source the card through a separately reviewed PCI boundary. This contract
 * deliberately carries only non-sensitive reservation/integration identifiers; it is not a token
 * vault, browser collection API, persistence model, or evidence that SF is PCI-ready.
 */
export type TravelportStaysReservationPaymentCardSource = Readonly<{
  acquirePaymentCard(
    context: TravelportStaysReservationPaymentCardSourceContext,
  ): Promise<TravelportStaysSensitiveReservationPaymentCard>;
}>;

function invalidSource(message: string): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function requiredIdentifier(value: unknown, label: string) {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\r\n]/.test(value)) {
    invalidSource(`${label} is invalid.`);
  }
  return value;
}

export async function acquireTravelportStaysReservationPaymentCard(
  source: TravelportStaysReservationPaymentCardSource,
  context: TravelportStaysReservationPaymentCardSourceContext,
) {
  if (!source || typeof source !== 'object' || typeof source.acquirePaymentCard !== 'function') {
    invalidSource('Travelport reservation payment-card source is unavailable.');
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    invalidSource('Travelport reservation payment-card source context is invalid.');
  }

  const normalizedContext = Object.freeze({
    organizationId: requiredIdentifier(context.organizationId, 'Travelport payment-card organization ID'),
    reservationId: requiredIdentifier(context.reservationId, 'Travelport payment-card reservation ID'),
    integrationId: requiredIdentifier(context.integrationId, 'Travelport payment-card integration ID'),
    integrationCredentialVersion: context.integrationCredentialVersion,
    attemptId: requiredIdentifier(context.attemptId, 'Travelport payment-card attempt ID'),
    purpose: context.purpose,
  });

  if (
    !Number.isInteger(normalizedContext.integrationCredentialVersion)
    || normalizedContext.integrationCredentialVersion < 1
  ) {
    invalidSource('Travelport payment-card integration credential version is invalid.');
  }
  if (
    normalizedContext.purpose !== 'INITIAL_CREATE'
    && normalizedContext.purpose !== 'REVIEW_ACCEPTANCE_CREATE'
  ) {
    invalidSource('Travelport reservation payment-card purpose is invalid.');
  }

  const paymentCard = await source.acquirePaymentCard(normalizedContext);
  if (!paymentCard || typeof paymentCard !== 'object' || Array.isArray(paymentCard)) {
    invalidSource('Travelport reservation payment-card source returned no usable card material.');
  }
  return paymentCard;
}
