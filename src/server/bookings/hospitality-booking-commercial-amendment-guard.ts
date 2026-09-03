import type { Prisma } from '../../generated/prisma/client.ts';

type CommercialAmendmentPaymentStatus = {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
};

type CommercialAmendmentReader = Pick<
  Prisma.TransactionClient,
  'hospitalityBookingCommercialAmendment' | 'paymentTransaction'
>;

export const ACTIVE_COMMERCIAL_AMENDMENT_CONFLICT_MESSAGE =
  'Booking has a commercial amendment that is active or requires payment recovery. Reconcile or finish that amendment before making another booking or payment change.';

export const COMMERCIAL_AMENDMENT_PAYMENT_RECOVERY_CONFLICT_MESSAGE =
  'Commercial amendment payment activity must be reconciled or compensated before the amendment can be cancelled or expired.';

export function hospitalityCommercialAmendmentPaymentActivityRequiresRecovery(
  transactions: readonly CommercialAmendmentPaymentStatus[],
) {
  return transactions.some((transaction) => transaction.status !== 'FAILED');
}

export async function hospitalityCommercialAmendmentHasPaymentActivityRequiringRecovery(input: {
  reader: Pick<Prisma.TransactionClient, 'paymentTransaction'>;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
}) {
  const transactions = await input.reader.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
    },
    select: { status: true },
  });
  return hospitalityCommercialAmendmentPaymentActivityRequiresRecovery(transactions);
}

export async function findActiveHospitalityBookingCommercialAmendment(input: {
  reader: CommercialAmendmentReader;
  organizationId: string;
  bookingId: string;
  now: Date;
}) {
  const amendment = await input.reader.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'PREPARED',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, direction: true, expiresAt: true },
  });
  if (!amendment) return null;
  if (amendment.expiresAt > input.now) return amendment;

  const requiresRecovery = await hospitalityCommercialAmendmentHasPaymentActivityRequiringRecovery({
    reader: input.reader,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    amendmentId: amendment.id,
  });
  return requiresRecovery ? amendment : null;
}
